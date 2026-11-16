#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera una sesion sintetica estilo DiDi "Viajes" para validar TIRÓN sin telefono:
frames PNG de 720x1600 con scroll y solape, encabezados de fecha en español,
tarjetas (hora | tipo | $monto) y sublinea km/min. Escribe ground_truth.csv.

Uso:
  python3 make_synthetic_frames.py --dir demo --hoy 2026-11-15
"""
import argparse
import csv
import io
import random
import sys
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# La consola de Windows (cp1252) no imprime "✓": UTF-8 con reemplazo, nunca rompe.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

W, H = 720, 1600
DIA_SEM = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def _font(candidatos, size):
    """Primera fuente disponible: Linux (DejaVu) → Windows (Arial) → macOS → fallback PIL."""
    for ruta in candidatos:
        try:
            return ImageFont.truetype(ruta, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size)  # Pillow >= 10.1
    except TypeError:
        return ImageFont.load_default()


F_BOLD = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "C:/Windows/Fonts/arialbd.ttf", "arialbd.ttf",
          "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]
F_REG = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "C:/Windows/Fonts/arial.ttf", "arial.ttf",
         "/System/Library/Fonts/Supplemental/Arial.ttf"]
F_TITLE = _font(F_BOLD, 40)
F_FECHA = _font(F_BOLD, 30)
F_HORA = _font(F_BOLD, 34)
F_TIPO = _font(F_REG, 30)
F_MONTO = _font(F_BOLD, 36)
F_SUB = _font(F_REG, 26)
F_CHIP = _font(F_BOLD, 28)


def fmt_clp(n):
    s = str(n)
    partes = []
    while len(s) > 3:
        partes.insert(0, s[-3:])
        s = s[:-3]
    partes.insert(0, s)
    return ".".join(partes)


def header_fecha(d: date):
    return "%s %d de %s" % (DIA_SEM[d.weekday()], d.day, MESES[d.month - 1])


def render(elementos, off):
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    for y, kind, dato in elementos:
        yy = y - off
        if yy < -80 or yy > H + 40:
            continue
        if kind == "titulo":
            d.text((40, yy), dato, font=F_TITLE, fill="black")
        elif kind == "chips":
            # "Todo" resaltado + grises
            d.rounded_rectangle([36, yy, 130, yy + 46], radius=23, fill="#ff7a00")
            d.text((52, yy + 7), "Todo", font=F_CHIP, fill="white")
            d.rounded_rectangle([142, yy, 262, yy + 46], radius=23, outline="#cccccc", width=2)
            d.text((158, yy + 7), "Semana", font=F_CHIP, fill="#666666")
            d.rounded_rectangle([274, yy, 388, yy + 46], radius=23, outline="#cccccc", width=2)
            d.text((290, yy + 7), "Mes", font=F_CHIP, fill="#666666")
        elif kind == "fecha":
            d.text((40, yy), dato, font=F_FECHA, fill="#555555")
            d.line([(40, yy + 42), (680, yy + 42)], fill="#e5e5e5", width=2)
        elif kind == "card":
            hora, tipo, monto = dato
            d.text((40, yy), hora, font=F_HORA, fill="black")
            d.text((150, yy + 4), tipo, font=F_TIPO, fill="#333333")
            wl = d.textlength(monto, font=F_MONTO)
            d.text((680 - wl, yy), monto, font=F_MONTO, fill="black")
        elif kind == "sub":
            d.text((150, yy), dato, font=F_SUB, fill="#999999")
        elif kind == "sep":
            d.line([(40, yy), (680, yy)], fill="#f0f0f0", width=2)
    return img


def jpegizar(img, q=87):
    """Compresion JPEG leve para simular artefactos de pantalla real."""
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="directorio de sesion (se crea frames/ dentro)")
    ap.add_argument("--hoy", default=date.today().isoformat(), help="fecha 'hoy' YYYY-MM-DD")
    ap.add_argument("--dias", type=int, default=16, help="cuantos dias hacia atras")
    ap.add_argument("--paso", type=int, default=700, help="pixels de scroll entre frames")
    a = ap.parse_args()

    random.seed(42)
    hoy = date.fromisoformat(a.hoy)
    tipos = ["DiDi Express", "DiDi Auto", "DiDi Express", "DiDi Taxi", "DiDi Auto"]
    viajes = []
    for k in range(a.dias):
        d = hoy - timedelta(days=k)
        n = random.choice([2, 3, 3, 4])
        minutos = sorted(random.sample(range(6 * 60, 23 * 60), n))
        for mnt in minutos:
            monto = random.randrange(2500, 18000, 10)
            # cada tanto, un monto estilo "ARS 4.800" (sin $) para probar el parser
            prefijo = "ARS " if len(viajes) % 17 == 5 else "$"
            viajes.append({"fecha": d.isoformat(),
                           "hora": "%02d:%02d" % (mnt // 60, mnt % 60),
                           "tipo": random.choice(tipos),
                           "monto_raw": prefijo + fmt_clp(monto),
                           "monto_num": monto,
                           "km": "%.1f" % random.uniform(1.5, 14.0),
                           "mins": random.randint(4, 38)})

    # pagina virtual
    elementos = []
    y = 70
    elementos.append((y, "titulo", "Historial de viajes"))
    y += 96
    elementos.append((y, "chips", None))
    y += 84
    prev = None
    for v in viajes:
        if v["fecha"] != prev:
            y += 40
            d = date.fromisoformat(v["fecha"])
            elementos.append((y, "fecha", header_fecha(d)))
            y += 62
            prev = v["fecha"]
        elementos.append((y, "card", (v["hora"], v["tipo"], v["monto_raw"])))
        y += 50
        elementos.append((y, "sub", "%s km · %d min" % (v["km"], v["mins"])))
        y += 42
        elementos.append((y, "sep", None))
        y += 22
    alto_total = y + 100

    ses = Path(a.dir)
    frames = ses / "frames"
    frames.mkdir(parents=True, exist_ok=True)
    offs = list(range(0, max(alto_total - H, 0) + 1, a.paso)) or [0]
    if offs[-1] != max(alto_total - H, 0):
        offs.append(max(alto_total - H, 0))
    for i, off in enumerate(offs, 1):
        jpegizar(render(elementos, off)).save(frames / ("frame_%04d.png" % i))
    with open(ses / "ground_truth.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=["fecha", "hora", "tipo", "monto_raw", "monto_num"],
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(viajes)
    print("[✓] %d frames en %s | %d viajes en ground_truth.csv | pagina virtual %dpx"
          % (len(offs), frames, len(viajes), alto_total))


if __name__ == "__main__":
    main()
