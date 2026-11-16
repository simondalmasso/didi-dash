#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Casos de la firma v2 y la politica `ambiguous`, sin OCR: se inyectan JSON de
OCR hechos a mano y se corre `tiron.py stitch` encima.

  A) solape cross-frame con ruido de tipo: "DiDi Auto" en f1, "DID1Auto" en f2
     -> 1 sola tarjeta, ok, tipo "DiDi Auto"
  B) dos viajes mismo minuto/monto, distinta modalidad, EN EL MISMO frame
     -> 2 tarjetas, ambas ambiguous (no se deduplica)
  C) conflicto cross-frame: Express en f1 vs Auto en f2 (misma fecha/hora/monto)
     -> 2 tarjetas, ambas ambiguous (no se deduplica)
  D) tipo desconocido en f1, conocido en f2
     -> 1 sola tarjeta, ok, tipo adoptado "DiDi Auto"
  E) monto estilo "ARS 4.800" (sin $) -> monto_num 4800
"""
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).parent
BASE = AQUI / "testdata" / "cases"
HOY = "2026-11-15"
FALLOS = []


def item(text, x1, y1, x2, y2, conf=0.99):
    return {"text": text, "conf": conf, "x1": x1, "y1": y1, "x2": x2, "y2": y2}


def header(y, texto="sábado 14 de noviembre"):
    return item(texto, 40, y, 420, y + 40)


def card(y, hora_tipo, monto):
    return [item(hora_tipo, 40, y, 400, y + 44), item(monto, 520, y, 680, y + 44)]


def escribir_sesion(nombre, frames):
    ses = BASE / nombre
    ocr = ses / "ocr"
    ocr.mkdir(parents=True)
    for i, items in enumerate(frames, 1):
        (ocr / ("frame_%04d.json" % i)).write_text(
            json.dumps({"frame": "frame_%04d.png" % i, "items": items}, ensure_ascii=False),
            encoding="utf-8")
    return ses


def stitch(ses):
    r = subprocess.run([sys.executable, str(AQUI / "tiron.py"), "stitch",
                        "--sesion", str(ses), "--hoy", HOY],
                       capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        sys.exit("[!] fallo stitch en %s" % ses)
    with open(ses / "out" / "ledger.csv", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def check(nombre, cond, detalle=""):
    print("  [%s] %s %s" % ("OK " if cond else "FAIL", nombre, detalle))
    if not cond:
        FALLOS.append(nombre)


def main():
    if BASE.exists():
        shutil.rmtree(BASE)

    # A) solape cross-frame con ruido de tipo
    filas = stitch(escribir_sesion("A_solape_ruido", [
        [header(100)] + card(200, "09:15 DiDi Auto", "$4.500"),
        [header(80)] + card(150, "09:15 DID1Auto", "$4.500"),
    ]))
    check("A: 1 sola tarjeta", len(filas) == 1, "(%d)" % len(filas))
    if filas:
        check("A: estado ok", filas[0]["estado"] == "ok", "(%s)" % filas[0]["estado"])
        check("A: tipo 'DiDi Auto'", filas[0]["tipo"] == "DiDi Auto", "(%r)" % filas[0]["tipo"])
        check("A: tipo_canon auto", filas[0]["tipo_canon"] == "auto", "(%s)" % filas[0]["tipo_canon"])

    # B) mismo frame, misma fecha/hora/monto, distinta modalidad
    filas = stitch(escribir_sesion("B_mismo_frame", [
        [header(100)] + card(200, "09:15 DiDi Express", "$4.500")
                     + card(340, "09:15 DiDi Auto", "$4.500"),
    ]))
    check("B: 2 tarjetas", len(filas) == 2, "(%d)" % len(filas))
    check("B: ambas ambiguous", all(f["estado"] == "ambiguous" for f in filas),
          "(%s)" % [f["estado"] for f in filas])

    # C) conflicto cross-frame: Express vs Auto, misma fecha/hora/monto
    filas = stitch(escribir_sesion("C_conflicto_cross", [
        [header(100)] + card(200, "10:30 DiDi Express", "$5.000"),
        [header(80)] + card(150, "10:30 DiDi Auto", "$5.000"),
    ]))
    check("C: 2 tarjetas (no dedup automatico)", len(filas) == 2, "(%d)" % len(filas))
    check("C: ambas ambiguous", all(f["estado"] == "ambiguous" for f in filas),
          "(%s)" % [f["estado"] for f in filas])

    # D) tipo desconocido en f1 -> conocido en f2 (upgrade en el solape)
    filas = stitch(escribir_sesion("D_upgrade", [
        [header(100), item("09:15", 40, 200, 130, 244), item("$4.500", 520, 200, 680, 244)],
        [header(80)] + card(150, "09:15 DiDi Auto", "$4.500"),
    ]))
    check("D: 1 sola tarjeta", len(filas) == 1, "(%d)" % len(filas))
    if filas:
        check("D: tipo adoptado 'DiDi Auto'", filas[0]["tipo"] == "DiDi Auto",
              "(%r)" % filas[0]["tipo"])
        check("D: tipo_canon auto", filas[0]["tipo_canon"] == "auto", "(%s)" % filas[0]["tipo_canon"])
        check("D: estado ok", filas[0]["estado"] == "ok", "(%s)" % filas[0]["estado"])

    # E) monto estilo ARS sin $
    filas = stitch(escribir_sesion("E_ars", [
        [header(100)] + card(200, "11:00 DiDi Express", "ARS 4.800"),
    ]))
    check("E: ARS 4.800 -> monto_num 4800",
          len(filas) == 1 and filas[0]["monto_num"] == "4800",
          "(%s)" % (filas[0]["monto_num"] if filas else "—"))

    print()
    if FALLOS:
        print("RESULTADO: FAIL (%s)" % ", ".join(FALLOS))
        sys.exit(1)
    print("RESULTADO: PASS — firma v2 (fecha+hora+monto+modalidad) y politica ambiguous OK.")


if __name__ == "__main__":
    main()
