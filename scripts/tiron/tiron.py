#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TIRÓN — mega-captura + OCR + costura de la lista "Viajes" de DiDi Conductor.

Pipeline:
  capture  : rafaga de screencaps por ADB mientras la lista se scrollea
             (manual: el operador scrollea | --auto-swipe: la herramienta scrollea sola)
  ocr      : RapidOCR (modelos PP-OCR en ONNX, 100% offline) sobre cada frame
  rows     : imprime las filas detectadas de un frame (para ajustar el layout real)
  stitch   : agrupa cajas en filas, detecta encabezados de fecha y tarjetas,
             deduplica entre frames por firma (fecha, hora, monto, modalidad)
             -> ledger.csv (registro interno) + candidatos.csv (handoff)
  delta    : compara el ledger contra el export del ledger vivo (/api/export)
             -> nuevos / duplicados / discrepancias / faltantes y reclasifica
                candidatos.csv

La herramienta NO toca la app mas alla de scrollear la lista (swipe vertical),
NO hace requests, y todo el procesamiento es local (los datos no salen de la maquina).

Sesion:
  <sesion>/frames/*.png      frames redaccionados (solo campos permitidos)
  <sesion>/ocr/*.json        cajas OCR permitidas + confidence; sin texto libre
  <sesion>/out/ledger.csv      registro normalizado (sin texto OCR libre)
  <sesion>/out/candidatos.csv  HANDOFF para el importer (clasificacion por fila)
  <sesion>/out/*.csv, *.txt    salidas de stitch y delta
"""
import argparse
import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from datetime import date, timedelta
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ============================================================
# PATRONES (ajustables si el layout real difiere -> usar `rows`)
# ============================================================
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
MESES_NUM = {m: i + 1 for i, m in enumerate(MESES)}
MESES_ABR = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
             "jul": 7, "ago": 8, "sep": 9, "set": 9, "oct": 10, "nov": 11, "dic": 12}
DIAS_SEM = {"lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"}

RE_HORA = re.compile(r"(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])")
RE_FECHA_HORA_UI = re.compile(
    r"(\d{1,2})/(\d{1,2})/(\d{4})[, ]+(\d{1,2}):([0-5]\d)\s*(am|pm)",
    re.IGNORECASE,
)
RE_MONTO = re.compile(r"(?:\$|\bARS\b)\s*([0-9OolI.,]+)", re.IGNORECASE)
RE_FECHA_ES = re.compile(
    r"(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)?\s*,?\s*"
    r"(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|"
    r"septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?",
    re.IGNORECASE)
RE_FECHA_ABR = re.compile(r"(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)", re.IGNORECASE)
RE_KMMIN = re.compile(r"^[\d.,\s]*(km)?[\s·:]*[\d.,\s]*(min)?[\s·:]*$", re.IGNORECASE)


def sin_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def limpiar_dinero(s: str) -> str:
    return (s.replace("O", "0").replace("o", "0")
             .replace("l", "1").replace("I", "1").replace(" ", ""))


# Modalidades conocidas de DiDi Conductor (Argentina: Express / Auto / Taxi)
MODALIDADES = ["express", "auto", "taxi", "flash", "delivery", "cancelado", "dedicated"]


def canon_tipo(t: str) -> str:
    """Modalidad canonica ('express', 'auto', ...) para firmar tarjetas sin que
    el ruido de OCR ('DID1Auto' vs 'DiDi Auto') genere duplicados falsos."""
    s = sin_acentos(t or "").lower()
    s = re.sub(r"[^a-z0-9]", "", s).replace("1", "i")
    for mod in MODALIDADES:
        if mod in s:
            return mod
    return s or "desconocido"


def tipos_compatibles(a: str, b: str) -> bool:
    """Compatibles si son la misma modalidad o una de las dos es desconocida."""
    return a == b or a == "desconocido" or b == "desconocido"


# ============================================================
# Parseo de fechas (encabezados de la UI y valores del export)
# ============================================================
def parse_fecha_hora_ui(texto: str):
    """Parse the DiDi card timestamp DD/MM/YYYY, h:mm am/pm strictly."""
    match = RE_FECHA_HORA_UI.fullmatch(str(texto or "").strip())
    if not match:
        return None
    day, month, year, hour, minute = map(int, match.groups()[:5])
    meridiem = match.group(6).lower()
    if not 1 <= hour <= 12:
        return None
    try:
        fecha = date(year, month, day).isoformat()
    except ValueError:
        return None
    hour = hour % 12
    if meridiem == "pm":
        hour += 12
    return fecha, "%02d:%02d" % (hour, minute)


def parse_fecha_header(texto: str):
    """Detecta si una fila es SOLO un encabezado de fecha. Devuelve 'YYYY-MM-DD' o None."""
    t = sin_acentos(texto).strip().lower().strip(".·|-– ")
    t = re.sub(r"\s+", " ", t)
    if t in ("hoy",):
        return "@hoy"
    if t in ("ayer",):
        return "@ayer"
    # solo encabezado: no debe contener hora ni monto
    if RE_HORA.search(t) or "$" in t:
        return None
    m = RE_FECHA_ES.fullmatch(t) or RE_FECHA_ES.search(t)
    if m and len(t) < 40:
        return "%s-%02d-%02d" % ("@Y", MESES_NUM[sin_acentos(m.group(2)).lower()], int(m.group(1)))
    m = RE_FECHA_ABR.fullmatch(t)
    if m and len(t) < 15:
        return "%s-%02d-%02d" % ("@Y", MESES_ABR[m.group(2).lower()], int(m.group(1)))
    return None


def resolver_fecha(token, hoy: date):
    """Convierte el token del header en fecha ISO, infiriendo el año."""
    if token == "@hoy":
        return hoy.isoformat()
    if token == "@ayer":
        return (hoy - timedelta(days=1)).isoformat()
    # formato @Y-MM-DD -> inferir año: si el mes quedo "en el futuro" respecto
    # de hoy, el encabezado pertenece al año anterior.
    anio_def = hoy.year
    pref, mes, dia = token.split("-")
    mes, dia = int(mes), int(dia)
    anio = anio_def
    if mes > hoy.month:
        anio = anio_def - 1
    return "%04d-%02d-%02d" % (anio, mes, dia)


def parse_fecha_libre(s: str, hoy: date):
    """Parser tolerante para fechas del CSV exportado."""
    t = sin_acentos(str(s)).strip().lower()
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = RE_FECHA_ES.search(t)
    if m:
        anio = int(m.group(3)) if m.group(3) else (hoy.year if int(MESES_NUM[sin_acentos(m.group(2)).lower()]) <= hoy.month else hoy.year - 1)
        return "%04d-%02d-%02d" % (anio, MESES_NUM[sin_acentos(m.group(2)).lower()], int(m.group(1)))
    m = RE_FECHA_ABR.search(t)
    if m:
        anio = hoy.year if MESES_ABR[m.group(2).lower()] <= hoy.month else hoy.year - 1
        return "%04d-%02d-%02d" % (anio, MESES_ABR[m.group(2).lower()], int(m.group(1)))
    m = re.search(r"(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?", t)  # DD/MM/YYYY (LatAm)
    if m:
        d, mes = int(m.group(1)), int(m.group(2))
        anio = int(m.group(3)) if m.group(3) else hoy.year
        if anio < 100:
            anio += 2000
        if 1 <= d <= 31 and 1 <= mes <= 12:
            return "%04d-%02d-%02d" % (anio, mes, d)
    return None


def _safe_date_header(text):
    normalized = sin_acentos(str(text or "")).strip().lower().strip(".·|-– ")
    normalized = re.sub(r"\\s+", " ", normalized)
    return (
        normalized in ("hoy", "ayer")
        or RE_FECHA_ES.fullmatch(normalized) is not None
        or RE_FECHA_ABR.fullmatch(normalized) is not None
    )


def _safe_modality(text):
    normalized = sin_acentos(str(text or "")).lower().replace("1", "i")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized).strip()
    return re.fullmatch(
        r"(?:didi\s*)?(?:express|auto|taxi|flash|delivery|cancelado|dedicated)",
        normalized,
    ) is not None


def _safe_detail(text):
    value = str(text or "").strip()
    return (
        RE_KMMIN.fullmatch(value) is not None
        and bool(re.search(r"\b(?:km|min)\b", value, re.IGNORECASE))
        and bool(re.search(r"\d", value))
    )


def sanitize_ocr_items(items):
    """Return only date/time/modality/amount/km/min OCR boxes; discard all free text."""
    safe = []
    amount_only = re.compile(r"\s*(?:\$|ARS)\s*[0-9OolI.,]+\s*", re.IGNORECASE)
    modality_token = re.compile(
        r"(?:didi\s*)?(?:express|auto|taxi|flash|delivery|cancelado|dedicated)",
        re.IGNORECASE,
    )
    for source in items or []:
        if not isinstance(source, dict):
            continue
        text = str(source.get("text") or "").strip()
        if not text:
            continue
        normalized = sin_acentos(text).lower()
        safe_value = (
            parse_fecha_hora_ui(text) is not None
            or _safe_date_header(text)
            or RE_HORA.fullmatch(text) is not None
            or amount_only.fullmatch(text) is not None
            or _safe_modality(text)
            or _safe_detail(text)
        )
        if not safe_value:
            # Some layouts combine time, modality and/or amount into one OCR box.
            remainder = RE_HORA.sub("", normalized)
            had_safe_token = bool(RE_HORA.search(normalized))
            amount = re.search(r"(?:\$|\bars\b)\s*[0-9ool.,]+", remainder, re.IGNORECASE)
            if amount:
                remainder = remainder[:amount.start()] + remainder[amount.end():]
                had_safe_token = True
            remainder = remainder.replace("1", "i")
            modality = modality_token.search(remainder)
            if modality:
                remainder = remainder[:modality.start()] + remainder[modality.end():]
                had_safe_token = True
            safe_value = had_safe_token and not remainder.strip(" \t|·—–-,:;")
        if not safe_value:
            continue
        row = {"text": text}
        for key in ("conf", "x1", "y1", "x2", "y2"):
            if key in source:
                row[key] = source[key]
        if all(key in row for key in ("x1", "y1", "x2", "y2")):
            safe.append(row)
    return safe


def redact_image(image, safe_items, padding=3):
    """Mask the full source in memory, restoring only allowlisted OCR text boxes."""
    from PIL import Image

    original = image.convert("RGB")
    redacted = Image.new("RGB", original.size, (24, 24, 24))
    width, height = original.size
    for item in safe_items or []:
        try:
            x1 = max(0, min(width, int(item["x1"]) - padding))
            y1 = max(0, min(height, int(item["y1"]) - padding))
            x2 = max(x1, min(width, int(item["x2"]) + padding))
            y2 = max(y1, min(height, int(item["y2"]) + padding))
        except (KeyError, TypeError, ValueError):
            continue
        if x2 > x1 and y2 > y1:
            redacted.paste(original.crop((x1, y1, x2, y2)), (x1, y1))
    return redacted


# ============================================================
# Motor OCR (adaptador rapidocr 3.x / rapidocr_onnxruntime 1.x)
# ============================================================
def make_engine():
    try:
        from rapidocr import RapidOCR  # rapidocr >= 3.x
        eng = RapidOCR()

        def call(path):
            res = eng(path)
            items = []
            if res is None or res.boxes is None or len(res.boxes) == 0:
                return items
            for bx, txt, sc in zip(res.boxes, res.txts, res.scores):
                xs = [float(p[0]) for p in bx]
                ys = [float(p[1]) for p in bx]
                items.append({"text": str(txt), "conf": round(float(sc), 3),
                              "x1": int(min(xs)), "y1": int(min(ys)),
                              "x2": int(max(xs)), "y2": int(max(ys))})
            return items
        return call
    except ImportError:
        pass
    try:
        from rapidocr_onnxruntime import RapidOCR  # paquete clasico 1.x
        eng = RapidOCR()

        def call(path):
            res, _ = eng(path)
            items = []
            if not res:
                return items
            for bx, txt, sc in res:
                xs = [float(p[0]) for p in bx]
                ys = [float(p[1]) for p in bx]
                items.append({"text": str(txt), "conf": round(float(sc), 3),
                              "x1": int(min(xs)), "y1": int(min(ys)),
                              "x2": int(max(xs)), "y2": int(max(ys))})
            return items
        return call
    except ImportError:
        sys.exit("[!] Falta el motor OCR. Instala con:\n"
                 "    pip install rapidocr onnxruntime\n"
                 "    (o bien: pip install rapidocr-onnxruntime)")


# ============================================================
# capture — rafaga de screencaps por ADB
# ============================================================
def adb(*args, binary=False, timeout=60):
    exe = shutil.which("adb")
    if not exe:
        sys.exit("[!] adb no esta en el PATH. Instala Android platform-tools.")
    r = subprocess.run([exe] + list(args), capture_output=True, timeout=timeout)
    if binary:
        return r.stdout, r.returncode
    return r.stdout.decode("utf-8", "replace"), r.returncode


def hash_contenido(png_bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    w, h = img.size
    recorte = img.crop((0, int(h * 0.06), w, int(h * 0.94))).resize((64, 128))
    return hashlib.md5(recorte.tobytes()).hexdigest()


def cmd_capture(a):
    ses = Path(a.sesion)
    out_txt, _ = adb("devices")
    lines = [l for l in out_txt.splitlines()[1:] if l.strip()]
    conectados = [l.split("\t")[0] for l in lines if l.endswith("device")]
    if not conectados:
        sys.exit("[!] No hay dispositivo conectado. Salida de `adb devices`:\n" + out_txt)
    if len(conectados) > 1 and not a.serial:
        sys.exit("[!] Hay varios dispositivos; usa --serial <id>. IDs: " + ", ".join(conectados))
    serial = a.serial or conectados[0]
    if a.serial:
        adb("-s", serial, "get-state")

    size_txt, _ = adb("-s", serial, "shell", "wm", "size")
    m = re.findall(r"(\d+)x(\d+)", size_txt)
    if not m:
        sys.exit("[!] No pude leer wm size: " + size_txt)
    W, H = map(int, m[-1])
    print("[i] Dispositivo %s — pantalla %dx%d" % (serial, W, H))

    focus, _ = adb("-s", serial, "shell", "dumpsys", "window")
    fm = re.search(r"mCurrentFocus[^\n]*", focus)
    if fm:
        print("[i] Foco actual: %s" % fm.group(0).strip()[:110])

    frames_dir = ses / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    previos = sorted(frames_dir.glob("frame_*.png"))
    if previos and not a.append:
        sys.exit("[i] %s ya tiene %d frames. Usa --append para continuar o cambia de --sesion."
                 % (frames_dir, len(previos)))
    n0 = len(previos)

    modo = "auto-swipe" if a.auto_swipe else "manual (scrollea vos; Ctrl+C corta)"
    print("[i] Modo: %s | guardando en %s" % (modo, frames_dir))
    if a.auto_swipe:
        print("[i] La herramienta va a scrollear la lista con swipes verticales (no toca nada mas).")
        print("[i] Empieza en %d s... (Ctrl+C para abortar)" % a.delay_inicio)
        time.sleep(a.delay_inicio)

    meta = {"w": W, "h": H, "modo": modo,
            "inicio": time.strftime("%Y-%m-%d %H:%M:%S"),
            "frame_policy": "opaque_mask_allowlisted_fields_only", "raw_saved": False}
    (ses / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    y1 = int(H * (0.50 + a.paso / 2))   # inicio del swipe (abajo)
    y2 = int(H * (0.50 - a.paso / 2))   # fin del swipe (arriba)
    prev_hash = None
    dups = 0
    guardados = 0
    t0 = time.time()
    engine = make_engine()
    from PIL import Image

    try:
        while guardados < a.max_frames:
            data, rc = adb("-s", serial, "exec-out", "screencap", "-p", binary=True)
            if rc != 0 or not data.startswith(bytes([137]) + b"PNG"):
                sys.exit("[!] screencap fallo (rc=%d, %d bytes). ¿adb muy viejo? usa platform-tools actualizado."
                         % (rc, len(data)))
            # The raw screenshot and unrestricted OCR exist only in memory.
            source_image = Image.open(io.BytesIO(data)).convert("RGB")
            safe_items = sanitize_ocr_items(engine(source_image))
            if not safe_items:
                print("[i] Frame sin campos permitidos; original descartado en memoria.")
                h = None
            else:
                safe_image = redact_image(source_image, safe_items)
                buffer = io.BytesIO()
                safe_image.save(buffer, format="PNG")
                safe_data = buffer.getvalue()
                h = hash_contenido(safe_data)
            if h is not None and h != prev_hash:
                n = n0 + guardados + 1
                (frames_dir / ("frame_%04d.png" % n)).write_bytes(safe_data)
                guardados += 1
                dups = 0
                prev_hash = h
                if guardados % 10 == 1 or guardados < 5:
                    print("  frame %04d  (%.0fs, redacted)" % (n, time.time() - t0))
            elif h is not None:
                dups += 1
                if a.auto_swipe and dups >= a.stop_dups:
                    print("[i] %d frames consecutivos sin cambios -> llegamos al final de la lista." % dups)
                    break
            if a.auto_swipe:
                adb("-s", serial, "shell", "input", "swipe",
                    str(W // 2), str(y1), str(W // 2), str(y2), "350")
                time.sleep(a.settle)
            else:
                time.sleep(a.interval)
    except KeyboardInterrupt:
        print("\n[i] Cortado por el operador.")
    print("[✓] Captura: %d frames nuevos en %.0fs -> %s" % (guardados, time.time() - t0, frames_dir))


# ============================================================
# ocr — cajas + texto por frame
# ============================================================
def cmd_ocr(a):
    ses = Path(a.sesion)
    frames = sorted(list((ses / "frames").glob("frame_*.png")) + list((ses / "frames").glob("frame_*.jpg")))
    if not frames:
        sys.exit("[i] No hay frames en %s/frames — corre `capture` primero." % ses)
    ocr_dir = ses / "ocr"
    ocr_dir.mkdir(parents=True, exist_ok=True)
    engine = make_engine()
    from PIL import Image

    hechos = 0
    t0 = time.time()
    for i, f in enumerate(frames, 1):
        dst = ocr_dir / (f.stem + ".json")
        # Never leave a stale OCR cache if this attempt fails.
        if dst.exists():
            dst.unlink()
        # Raw source exists in memory. Mask its on-disk copy before OCR so a
        # later engine failure cannot leave readable passenger data on disk.
        source_image = Image.open(f).convert("RGB")
        image_format = "JPEG" if f.suffix.lower() in (".jpg", ".jpeg") else "PNG"
        buffer = io.BytesIO()
        redact_image(source_image, []).save(buffer, format=image_format)
        f.write_bytes(buffer.getvalue())

        items = sanitize_ocr_items(engine(source_image))
        safe_image = redact_image(source_image, items)
        buffer = io.BytesIO()
        safe_image.save(buffer, format=image_format)
        f.write_bytes(buffer.getvalue())
        datos = {"frame": f.name, "items": items, "redacted": True}
        dst.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
        hechos += 1
        if hechos % 10 == 1:
            print("  ocr %d/%d (%.0fs)" % (i, len(frames), time.time() - t0))
    print("[OK] OCR: %d frames procesados y redaccionados -> %s" % (hechos, ocr_dir))


# ============================================================
# rows — sonda de layout
# ============================================================
def items_con_geom(datos):
    items = []
    for it in datos["items"]:
        it = dict(it)
        it["cx"] = (it["x1"] + it["x2"]) / 2.0
        it["cy"] = (it["y1"] + it["y2"]) / 2.0
        it["w"] = it["x2"] - it["x1"]
        it["h"] = it["y2"] - it["y1"]
        items.append(it)
    return items


def agrupar_filas(items):
    """Agrupa cajas en filas visuales por cercania vertical."""
    if not items:
        return []
    items = sorted(items, key=lambda it: (it["cy"], it["cx"]))
    alturas = sorted(it["h"] for it in items)
    med = alturas[len(alturas) // 2]
    umbral = max(12.0, med * 0.7)
    filas, actual, ref = [], [items[0]], items[0]["cy"]
    for it in items[1:]:
        if abs(it["cy"] - ref) <= umbral:
            actual.append(it)
            ref = sum(x["cy"] for x in actual) / len(actual)
        else:
            filas.append(sorted(actual, key=lambda x: x["cx"]))
            actual, ref = [it], it["cy"]
    filas.append(sorted(actual, key=lambda x: x["cx"]))
    return filas


def fila_texto(fila):
    return " ".join(it["text"] for it in fila).strip()


def cmd_rows(a):
    ses = Path(a.sesion)
    ocr_dir = ses / "ocr"
    if not ocr_dir.exists():
        sys.exit("[i] No hay OCR en %s/ocr — corre `ocr` primero." % ses)
    if a.frame:
        archivos = [ocr_dir / ("frame_%04d.json" % a.frame)]
        if not archivos[0].exists():
            sys.exit("[i] No existe %s. Disponibles: %s"
                     % (archivos[0], ", ".join(p.name for p in sorted(ocr_dir.glob('*.json'))[:8]) + " ..."))
    else:
        archivos = sorted(ocr_dir.glob("*.json"))
    for arch in archivos:
        datos = json.loads(arch.read_text(encoding="utf-8"))
        items = items_con_geom({"items": sanitize_ocr_items(datos.get("items", []))})
        print("== %s (%d cajas) ==" % (datos["frame"], len(items)))
        for i, fila in enumerate(agrupar_filas(items), 1):
            partes = ["%s (x=%.0f)" % (it["text"], it["cx"]) for it in fila]
            print("  fila %2d | y=%4.0f | %s" % (i, fila[0]["cy"], "  |  ".join(partes)))


# ============================================================
# stitch — filas -> tarjetas -> ledger deduplicado
# ============================================================
def clasificar_fila(fila):
    texto = fila_texto(fila)
    t = sin_acentos(texto)
    cy = sum(it["cy"] for it in fila) / len(fila)
    conf = sum(it["conf"] for it in fila) / len(fila)

    fecha_hora = parse_fecha_hora_ui(texto)
    if fecha_hora:
        return {"kind": "fecha_hora", "token": fecha_hora[0],
                "hora": fecha_hora[1], "cy": cy}

    tok = parse_fecha_header(t)
    if tok:
        return {"kind": "fecha", "token": tok, "cy": cy}

    hora = RE_HORA.search(t)
    monto_raw = monto_digits = None
    monto_item = None
    for it in reversed(fila):
        itn = sin_acentos(it["text"])
        m = RE_MONTO.search(itn)
        if m:
            raw = limpiar_dinero(m.group(1))
            digits = re.sub(r"\D", "", raw)
            if digits:
                monto_raw, monto_digits, monto_item = raw, int(digits), it
                break
    if monto_digits is None and hora:
        it = fila[-1]
        itn = limpiar_dinero(sin_acentos(it["text"]))
        if re.fullmatch(r"[\d.,]{4,}", itn):
            digits = re.sub(r"\D", "", itn)
            if digits:
                monto_raw, monto_digits, monto_item = itn, int(digits), it

    if hora or monto_digits:
        tipo = ""
        for it in fila:
            if it is monto_item:
                continue
            candidate = RE_HORA.sub("", sin_acentos(it["text"]))
            candidate = re.sub(r"^[\s|:·—–-]+|[\s|:·—–-]+$", "", candidate)
            if candidate and _safe_modality(candidate):
                tipo = (tipo + " " + candidate).strip()
        return {
            "kind": "card",
            "hora": hora.group(0) if hora else None,
            "monto_raw": monto_raw,
            "monto_digits": monto_digits,
            "tipo": tipo,
            "conf": round(conf, 3),
            "cy": cy,
        }

    return {
        "kind": "otra",
        "detalle": texto if _safe_detail(texto) else "",
        "cy": cy,
    }


def procesar_frame(items):
    """Build allowlisted events only; free-form OCR text never leaves memory."""
    filas = agrupar_filas(items)
    eventos, sin_parsear, otras = [], [], []
    for fila in filas:
        ev = clasificar_fila(fila)
        if ev["kind"] == "otra":
            if ev.get("detalle"):
                otras.append({"cy": ev["cy"], "detalle": ev["detalle"]})
        else:
            eventos.append(ev)
    eventos.sort(key=lambda e: e["cy"])

    resueltos = []
    timestamp_pendiente = None
    i = 0
    while i < len(eventos):
        ev = eventos[i]
        if ev["kind"] == "fecha_hora":
            timestamp_pendiente = ev
            i += 1
            continue
        if ev["kind"] == "card" and timestamp_pendiente:
            if not ev.get("hora"):
                ev["hora"] = timestamp_pendiente["hora"]
            ev["token"] = timestamp_pendiente["token"]
            timestamp_pendiente = None
        if ev["kind"] == "card" and ev["hora"] and not ev["monto_digits"]:
            if (i + 1 < len(eventos) and eventos[i + 1]["kind"] == "card"
                    and eventos[i + 1]["monto_digits"] and not eventos[i + 1]["hora"]
                    and abs(eventos[i + 1]["cy"] - ev["cy"]) < 150):
                ev["monto_raw"] = eventos[i + 1]["monto_raw"]
                ev["monto_digits"] = eventos[i + 1]["monto_digits"]
                i += 1
        if ev["kind"] == "card":
            if ev["hora"] and ev["monto_digits"]:
                resueltos.append(ev)
            else:
                sin_parsear.append({
                    "motivo": "sin_monto" if ev["hora"] else "sin_hora",
                    "y": round(ev["cy"]),
                })
        else:
            resueltos.append(ev)
        i += 1
    return resueltos, sin_parsear, otras


def escribir_candidatos(ses, ledger, delta=None):
    """Escribe out/candidatos.csv: el archivo de HANDOFF para el importer.
    ledger.csv es el registro interno de adquisicion; candidatos.csv es la
    vista clasificada que consume la Fase 2 (nuevos -> abrir detalle).
    delta: None (sin export -> sin_comparar) o
           {'dup': set, 'nuevos': set, 'discr_fh': set}."""
    delta = delta or {}
    dup = delta.get("dup", set())
    nuevos = delta.get("nuevos", set())
    discr_fh = delta.get("discr_fh", set())
    filas = []
    for e in ledger:
        estado = e["estado"]
        if estado.startswith("descartado"):
            clasif = "descartado"
        elif estado == "ambiguous":
            clasif = "ambiguous"
        elif (e["fecha"], e["hora"]) in discr_fh:
            clasif = "discrepancia"
        elif (e["fecha"], e["hora"], int(e["monto_num"])) in nuevos:
            clasif = "nuevo"
        elif (e["fecha"], e["hora"], int(e["monto_num"])) in dup:
            clasif = "duplicado"
        elif estado == "revisar":
            clasif = "revisar"
        else:
            clasif = "sin_comparar"
        filas.append(dict(e, clasificacion=clasif))
    cols = ["fecha", "hora", "tipo", "tipo_canon", "detalle", "monto_raw", "monto_num",
            "conf_ocr", "fecha_confiable", "frame", "y", "estado", "clasificacion"]
    ruta = Path(ses) / "out" / "candidatos.csv"
    with open(ruta, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(filas)
    return ruta


def cmd_stitch(a):
    ses = Path(a.sesion)
    hoy = date.fromisoformat(a.hoy)
    ocr_dir = ses / "ocr"
    archivos = sorted(ocr_dir.glob("*.json")) if ocr_dir.exists() else []
    if not archivos:
        sys.exit("[i] No hay OCR en %s/ocr — corre `ocr` primero." % ses)

    ledger, por_fhm = [], {}
    fecha_carry = None
    sin_parsear_total = []

    for arch in archivos:
        datos = json.loads(arch.read_text(encoding="utf-8"))
        items = items_con_geom({"items": sanitize_ocr_items(datos.get("items", []))})
        eventos, sin_parsear, otras_raw = procesar_frame(items)
        frame = datos["frame"]
        for sp in sin_parsear:
            sp["frame"] = frame
        sin_parsear_total.extend(sin_parsear)

        header_en_frame = False
        fhm_en_frame = {}  # (fecha, hora, monto) -> n de tarjetas vistas en ESTE frame
        for ev in eventos:  # ya ordenados por y
            if ev["kind"] == "fecha":
                fecha_carry = resolver_fecha(ev["token"], hoy)
                header_en_frame = True
                continue
            if ev.get("token"):
                fecha_carry = resolver_fecha(ev["token"], hoy)
                header_en_frame = True
            # tarjeta: fecha vigente (timestamp/header de este frame, o la heredada)
            fecha = fecha_carry
            if fecha is None:
                sin_parsear_total.append({"frame": frame, "motivo": "sin_fecha",
                                          "y": round(ev["cy"])})
                continue
            canon = canon_tipo(ev["tipo"])
            fhm = (fecha, ev["hora"], ev["monto_digits"])
            fhm_en_frame[fhm] = fhm_en_frame.get(fhm, 0) + 1
            previos = por_fhm.get(fhm, [])
            if fhm_en_frame[fhm] >= 2:
                # dos tarjetas con la misma firma en un MISMO frame: viajes
                # distintos -> no deduplicar, marcar ambiguous
                estado = "ambiguous"
                for i in previos:
                    ledger[i]["estado"] = "ambiguous"
            else:
                compat = [i for i in previos if tipos_compatibles(ledger[i]["tipo_canon"], canon)]
                if compat:
                    # solape normal entre frames: mismo viaje ya capturado
                    # (si el existente tenia tipo desconocido, adoptar el conocido)
                    for i in compat:
                        if ledger[i]["tipo_canon"] == "desconocido" and canon != "desconocido":
                            ledger[i]["tipo"] = ev["tipo"]
                            ledger[i]["tipo_canon"] = canon
                    continue
                if previos:
                    # misma (fecha, hora, monto) con modalidad distinta: conflicto
                    # -> no deduplicar automaticamente, marcar ambiguous
                    estado = "ambiguous"
                    for i in previos:
                        ledger[i]["estado"] = "ambiguous"
                else:
                    estado = "ok"
            # detalle km/min: fila de contexto inmediatamente debajo de la tarjeta
            detalle = ""
            for otra in otras_raw:
                if 0 < otra["cy"] - ev["cy"] < 70:
                    detalle = otra["detalle"]
                    break
            por_fhm.setdefault(fhm, []).append(len(ledger))
            ledger.append({"fecha": fecha, "hora": ev["hora"], "tipo": ev["tipo"],
                           "tipo_canon": canon, "detalle": detalle,
                           "monto_raw": ev["monto_raw"], "monto_num": ev["monto_digits"],
                           "conf_ocr": ev["conf"],
                           "fecha_confiable": "si" if header_en_frame else "no",
                           "frame": frame, "y": round(ev["cy"]), "estado": estado})

    # --- ajustes post ---
    # (hora, monto) duplicado con fechas distintas: gana la fecha confiable.
    # Los pares ambiguous son intencionales: no se tocan.
    por_hm = {}
    for i, e in enumerate(ledger):
        if e["estado"] == "ambiguous":
            continue
        por_hm.setdefault((e["hora"], e["monto_num"]), []).append(i)
    for hm, idxs in por_hm.items():
        if len(idxs) > 1:
            confiables = [i for i in idxs if ledger[i]["fecha_confiable"] == "si"]
            if confiables:
                for i in idxs:
                    if i not in confiables:
                        ledger[i]["estado"] = "descartado_fecha_inferida"
    # (fecha, hora) con montos distintos -> revisar (ambiguous se conserva)
    por_fh = {}
    for i, e in enumerate(ledger):
        if e["estado"].startswith("descartado") or e["estado"] == "ambiguous":
            continue
        por_fh.setdefault((e["fecha"], e["hora"]), []).append(i)
    for fh, idxs in por_fh.items():
        if len(idxs) > 1:
            for i in idxs:
                ledger[i]["estado"] = "revisar"

    out = ses / "out"
    out.mkdir(parents=True, exist_ok=True)
    cols = ["fecha", "hora", "tipo", "tipo_canon", "detalle", "monto_raw", "monto_num",
            "conf_ocr", "fecha_confiable", "frame", "y", "estado"]
    with open(out / "ledger.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(ledger)
    with open(out / "filas_sin_parsear.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["frame", "motivo", "y"])
        for sp in sin_parsear_total:
            w.writerow([sp["frame"], sp["motivo"], sp["y"]])
    escribir_candidatos(ses, ledger)

    vivos = [e for e in ledger if not e["estado"].startswith("descartado")]
    por_fecha = {}
    for e in vivos:
        por_fecha[e["fecha"]] = por_fecha.get(e["fecha"], 0) + 1
    resumen = [
        "RESUMEN STITCH — sesion %s" % ses,
        "frames OCR: %d" % len(archivos),
        "tarjetas en ledger: %d (ok=%d, ambiguous=%d, revisar=%d, descartadas=%d)"
        % (len(ledger), sum(1 for e in vivos if e["estado"] == "ok"),
           sum(1 for e in vivos if e["estado"] == "ambiguous"),
           sum(1 for e in vivos if e["estado"] == "revisar"),
           sum(1 for e in ledger if e["estado"].startswith("descartado"))),
        "filas sin parsear: %d (ver filas_sin_parsear.csv)" % len(sin_parsear_total),
        "suma de montos (num): %d" % sum(e["monto_num"] for e in vivos),
        "handoff: out/candidatos.csv (clasificacion provisional sin_comparar)",
        "viajes por fecha:",
    ] + ["  %s : %d" % (f, c) for f, c in sorted(por_fecha.items(), reverse=True)]
    (out / "resumen.txt").write_text("\n".join(resumen) + "\n", encoding="utf-8")
    print("\n".join(resumen))
    print("[✓] Salidas en %s" % out)


# ============================================================
# delta — ledger vs export del ledger vivo
# ============================================================
def leer_export(path, sep=None):
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        muestra = fh.read(4096)
        fh.seek(0)
        if not sep:
            try:
                sep = csv.Sniffer().sniff(muestra, delimiters=",;\t|").delimiter
            except Exception:
                sep = ";" if muestra.count(";") > muestra.count(",") else ","
            fh.seek(0)
        filas = list(csv.DictReader(fh, delimiter=sep))
    return filas, sep


def norm_col(nombre):
    return sin_acentos(nombre).lower().replace(" ", "").replace("_", "").replace("-", "")


def cmd_delta(a):
    ses = Path(a.sesion)
    hoy = date.fromisoformat(a.hoy)
    ledger_path = ses / "out" / "ledger.csv"
    if not ledger_path.exists():
        sys.exit("[i] Falta %s — corre `stitch` primero." % ledger_path)
    with open(ledger_path, encoding="utf-8-sig", newline="") as fh:
        ledger_todos = list(csv.DictReader(fh))
    ledger = [r for r in ledger_todos if not r["estado"].startswith("descartado")]
    if not ledger:
        sys.exit("[i] El ledger quedo vacio — revisa out/filas_sin_parsear.csv y el comando `rows`.")

    if not Path(a.export).exists():
        sys.exit("[i] No existe el export: %s" % a.export)
    filas, sep = leer_export(a.export)
    if not filas:
        sys.exit("[i] El export esta vacio.")
    headers = list(filas[0].keys())

    def encontrar(candidatos, obligatorio=False):
        for h in headers:
            n = norm_col(h)
            for c in candidatos:
                if n == c or n.startswith(c):
                    return h
        return None

    col_fecha = a.col_fecha or encontrar(["fecha", "dia", "date", "fechaviaje", "fechainicio", "createdat", "created", "fechaorden"])
    col_hora = a.col_hora or encontrar(["hora", "time", "horaviaje", "horainicio", "hh"])
    col_monto = a.col_monto or encontrar(["monto", "amount", "total", "ingreso", "importe", "precio", "valor", "ganancia", "pago"])
    print("[i] Export: %d filas, separador %r, columnas: fecha=%r hora=%r monto=%r (headers: %s)"
          % (len(filas), sep, col_fecha, col_hora, col_monto, ", ".join(headers)))

    export = []
    for r in filas:
        fv = r.get(col_fecha, "") if col_fecha else ""
        hv = r.get(col_hora, "") if col_hora else ""
        # datetime combinada en la columna de fecha
        if fv and not hv and " " in fv:
            partes = fv.split(" ", 1)
            hm2 = RE_HORA.search(sin_acentos(partes[1]))
            if hm2:
                fv, hv = partes[0], hm2.group(0)
        f = parse_fecha_libre(fv, hoy) if fv else None
        hm = RE_HORA.search(sin_acentos(hv)) if hv else None
        mv = r.get(col_monto, "") if col_monto else ""
        md = re.sub(r"\D", "", limpiar_dinero(sin_acentos(str(mv))))
        if not f or not hm or not md:
            continue
        export.append({"fecha": f, "hora": hm.group(0), "digits": int(md),
                       "monto_raw": str(mv).strip(), "fila": r})
    if not export:
        sys.exit("[!] No pude extraer (fecha, hora, monto) de ninguna fila del export.\n"
                 "    Usa --col-fecha / --col-hora / --col-monto para indicarlas.\n"
                 "    Headers detectados: %s" % ", ".join(headers))

    L = {}
    for e in ledger:
        L[(e["fecha"], e["hora"], int(e["monto_num"]))] = e
    E = {}
    for e in export:
        E.setdefault((e["fecha"], e["hora"], e["digits"]), e)

    dup_keys = set(L) & set(E)
    nuevos_keys = set(L) - set(E)
    # discrepancias: misma (fecha, hora) con monto distinto
    L_fh, E_fh = {}, {}
    for k, e in L.items():
        L_fh.setdefault((k[0], k[1]), []).append(e)
    for k, e in E.items():
        E_fh.setdefault((k[0], k[1]), []).append(e)
    discr = []
    for fh in set(L_fh) & set(E_fh):
        dl = {int(e["monto_num"]) for e in L_fh[fh]}
        de = {e["digits"] for e in E_fh[fh]}
        if dl != de:
            for e in L_fh[fh]:
                for x in E_fh[fh]:
                    discr.append({"fecha": fh[0], "hora": fh[1],
                                  "monto_ui": int(e["monto_num"]), "monto_export": x["digits"],
                                  "frame": e.get("frame", ""), "tipo": e.get("tipo", "")})
    nuevos_keys -= {k for k in list(nuevos_keys) if any(d["fecha"] == k[0] and d["hora"] == k[1] for d in discr)}
    # faltantes: solo los que ni siquiera coinciden en fecha+hora (los demas son discrepancias)
    faltantes_keys = {k for k in (set(E) - set(L)) if (k[0], k[1]) not in L_fh}

    out = ses / "out" / "delta"
    out.mkdir(parents=True, exist_ok=True)

    def write_csv(nombre, cols, filas_out):
        with open(out / nombre, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=cols)
            w.writeheader()
            w.writerows(filas_out)

    write_csv("duplicados.csv", list(ledger[0].keys()),
              [L[k] for k in sorted(dup_keys)])
    write_csv("nuevos.csv", list(ledger[0].keys()),
              [L[k] for k in sorted(nuevos_keys)])
    write_csv("faltantes_en_ui.csv", ["fecha", "hora", "monto_raw", "digits"],
              [{"fecha": k[0], "hora": k[1], "monto_raw": E[k]["monto_raw"], "digits": k[2]}
               for k in sorted(faltantes_keys)])
    write_csv("discrepancias.csv", ["fecha", "hora", "monto_ui", "monto_export", "frame", "tipo"], discr)

    # reclasificar candidatos.csv con el resultado del delta (handoff para Fase 2)
    escribir_candidatos(ses, ledger_todos,
                        {"dup": dup_keys, "nuevos": nuevos_keys,
                         "discr_fh": {(d["fecha"], d["hora"]) for d in discr}})

    resumen = [
        "RESUMEN DELTA — %s" % a.export,
        "ledger UI: %d viajes | export: %d viajes" % (len(L), len(E)),
        "DUPLICADOS (ya en el ledger vivo): %d" % len(dup_keys),
        "NUEVOS (solo en la UI, candidatos a insertar): %d" % len(nuevos_keys),
        "DISCREPANCIAS (misma fecha+hora, monto distinto): %d" % len(discr),
        "FALTANTES EN UI (en el export, no vistos en la captura): %d" % len(faltantes_keys),
        "handoff: out/candidatos.csv reclasificado (nuevo/duplicado/discrepancia)",
    ]
    (out / "resumen_delta.txt").write_text("\n".join(resumen) + "\n", encoding="utf-8")
    print("\n".join(resumen))
    print("[✓] Salidas en %s" % out)


# ============================================================
# CLI
# ============================================================
def main():
    # La consola de Windows (cp1252) no imprime "✓"/acentos: UTF-8 con reemplazo.
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    p = argparse.ArgumentParser(
        prog="tiron",
        description="TIRÓN — mega-captura + OCR + costura de la lista Viajes de DiDi. "
                    "Todo local, sin requests, la app solo se scrollea.")
    sub = p.add_subparsers(dest="cmd", required=True)

    def sesion_arg(sp):
        sp.add_argument("--sesion", required=True, help="directorio de la sesion (frames/ocr/out)")

    sp = sub.add_parser("capture", help="captura frames por ADB (manual o --auto-swipe)")
    sesion_arg(sp)
    sp.add_argument("--auto-swipe", action="store_true",
                    help="la herramienta scrollea sola (swipes verticales)")
    sp.add_argument("--serial", default="", help="id del dispositivo si hay varios")
    sp.add_argument("--interval", type=float, default=1.0, help="segundos entre frames en modo manual")
    sp.add_argument("--settle", type=float, default=0.8, help="pausa tras cada swipe (auto)")
    sp.add_argument("--paso", type=float, default=0.42, help="fraccion de pantalla por swipe (auto)")
    sp.add_argument("--stop-dups", type=int, default=3, help="frames sin cambios seguidos para frenar (auto)")
    sp.add_argument("--max-frames", type=int, default=500, help="limite de seguridad")
    sp.add_argument("--delay-inicio", type=int, default=3, help="cuenta regresiva antes del auto-swipe")
    sp.add_argument("--append", action="store_true", help="continuar numerando frames existentes")
    sp.set_defaults(fn=cmd_capture)

    sp = sub.add_parser("ocr", help="OCR sobre todos los frames (resumible)")
    sesion_arg(sp)
    sp.add_argument("--force", action="store_true", help="reprocesar aunque exista el json")
    sp.set_defaults(fn=cmd_ocr)

    sp = sub.add_parser("rows", help="ver filas detectadas (sonda de layout)")
    sesion_arg(sp)
    sp.add_argument("--frame", type=int, default=0, help="numero de frame (0 = todos)")
    sp.set_defaults(fn=cmd_rows)

    sp = sub.add_parser("stitch", help="costura frames -> ledger.csv")
    sesion_arg(sp)
    sp.add_argument("--hoy", default=date.today().isoformat(), help="fecha 'hoy' para resolver Hoy/Ayer (YYYY-MM-DD)")
    sp.set_defaults(fn=cmd_stitch)

    sp = sub.add_parser("delta", help="comparar ledger vs export del ledger vivo")
    sesion_arg(sp)
    sp.add_argument("--export", required=True, help="CSV exportado del ledger vivo (/api/export)")
    sp.add_argument("--hoy", default=date.today().isoformat())
    sp.add_argument("--col-fecha", default="", help="forzar columna de fecha")
    sp.add_argument("--col-hora", default="", help="forzar columna de hora")
    sp.add_argument("--col-monto", default="", help="forzar columna de monto")
    sp.set_defaults(fn=cmd_delta)

    sp = sub.add_parser("all", help="ocr + stitch (+ delta si --export)")
    sesion_arg(sp)
    sp.add_argument("--hoy", default=date.today().isoformat())
    sp.add_argument("--export", default="", help="CSV export para delta (opcional)")
    sp.add_argument("--col-fecha", default="")
    sp.add_argument("--col-hora", default="")
    sp.add_argument("--col-monto", default="")
    sp.set_defaults(fn=lambda a: (cmd_ocr(a), cmd_stitch(a),
                                  cmd_delta(a) if a.export else None))

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
