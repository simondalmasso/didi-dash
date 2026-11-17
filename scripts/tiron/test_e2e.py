#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test end-to-end de TIRÓN sin telefono:
  1. genera sesion sintetica estilo DiDi (frames + ground truth)
  2. corre tiron.py ocr + stitch
  3. compara ledger vs ground truth (recall >= 95%, sin fantasmas)
  4. arma un export falso (saca 5 viajes, cambia 1 monto) y corre delta
  5. valida: nuevos=5, discrepancias=1, duplicados=N-6, faltantes=0

Sale con codigo 0 (PASS) o 1 (FAIL).
"""
import csv
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

AQUI = Path(__file__).parent
SESION = AQUI / "testdata" / "sesion_test"
HOY = "2026-11-15"
FALLOS = []


def correr(cmd):
    print("$ " + " ".join(str(c) for c in cmd))
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        sys.exit("[!] Fallo el comando: %s" % cmd)
    return r.stdout


def check(nombre, cond, detalle=""):
    print("  [%s] %s %s" % ("OK " if cond else "FAIL", nombre, detalle))
    if not cond:
        FALLOS.append(nombre)


def main():
    if SESION.exists():
        shutil.rmtree(SESION)

    # 1) sesion sintetica
    correr([sys.executable, AQUI / "make_synthetic_frames.py",
            "--dir", SESION, "--hoy", HOY])
    n_frames = len(list((SESION / "frames").glob("*.png")))
    with open(SESION / "ground_truth.csv", encoding="utf-8-sig", newline="") as fh:
        truth = list(csv.DictReader(fh))
    print("[i] frames=%d viajes_truth=%d" % (n_frames, len(truth)))
    check("frames suficientes para probar solape", n_frames >= 6)

    # 2) ocr + stitch
    t0 = time.time()
    correr([sys.executable, AQUI / "tiron.py", "ocr", "--sesion", SESION])
    t_ocr = time.time() - t0
    correr([sys.executable, AQUI / "tiron.py", "stitch", "--sesion", SESION, "--hoy", HOY])
    print("[i] OCR de %d frames: %.0fs (%.1fs/frame)" % (n_frames, t_ocr, t_ocr / n_frames))

    with open(SESION / "out" / "ledger.csv", encoding="utf-8-sig", newline="") as fh:
        ledger = [r for r in csv.DictReader(fh) if not r["estado"].startswith("descartado")]
    T = {(r["fecha"], r["hora"], int(r["monto_num"])) for r in truth}
    L = {(r["fecha"], r["hora"], int(r["monto_num"])) for r in ledger}
    matched = T & L
    fantasmas = L - T
    perdidos = T - L
    recall = len(matched) / len(T)

    print("[i] truth=%d ledger=%d match=%d perdidos=%d fantasmas=%d recall=%.1f%%"
          % (len(T), len(L), len(matched), len(perdidos), len(fantasmas), 100 * recall))
    for p in sorted(perdidos):
        print("    perdido: %s" % (p,))
    for f in sorted(fantasmas):
        print("    fantasma: %s" % (f,))
    check("recall >= 95%%", recall >= 0.95, "(%.1f%%)" % (100 * recall))
    check("sin viajes fantasma", len(fantasmas) == 0, "(%d)" % len(fantasmas))
    suma_L = sum(int(r["monto_num"]) for r in ledger)
    suma_T = sum(int(r["monto_num"]) for r in truth)
    check("suma de montos coincide", suma_L == suma_T, "(ui=%d truth=%d)" % (suma_L, suma_T))
    sin_parsear = (SESION / "out" / "filas_sin_parsear.csv")
    with open(sin_parsear, encoding="utf-8-sig", newline="") as fh:
        n_sp = sum(1 for _ in csv.DictReader(fh))
    check("filas sin parsear bajas", n_sp <= 3, "(%d)" % n_sp)
    tipos_ok = sum(1 for r in ledger if r["tipo"].strip())
    print("[i] tipo capturado en %d/%d tarjetas" % (tipos_ok, len(ledger)))

    # 3) delta contra un export fabricado del propio ledger
    vivos = sorted(ledger, key=lambda r: (r["fecha"], r["hora"]))
    random.seed(7)
    sacar = set(random.sample(range(len(vivos)), 5))
    cambiar = next(i for i in range(len(vivos)) if i not in sacar)
    export_path = SESION / "export_fake.csv"
    with open(export_path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["fecha", "hora", "tipo", "monto", "detalle"])
        for i, r in enumerate(vivos):
            if i in sacar:
                continue
            monto = r["monto_raw"]
            if i == cambiar:
                monto = "$" + format(int(r["monto_num"]) + 1000, ",").replace(",", ".")
            w.writerow([r["fecha"], r["hora"], r["tipo"], monto, r.get("detalle", "")])

    correr([sys.executable, AQUI / "tiron.py", "delta", "--sesion", SESION,
            "--export", export_path, "--hoy", HOY])

    def filas_delta(nombre):
        with open(SESION / "out" / "delta" / nombre, encoding="utf-8-sig", newline="") as fh:
            return list(csv.DictReader(fh))

    n_nuevos = len(filas_delta("nuevos.csv"))
    n_discr = len(filas_delta("discrepancias.csv"))
    n_dup = len(filas_delta("duplicados.csv"))
    n_falt = len(filas_delta("faltantes_en_ui.csv"))
    print("[i] delta: nuevos=%d discrepancias=%d duplicados=%d faltantes=%d"
          % (n_nuevos, n_discr, n_dup, n_falt))
    check("delta: nuevos == 5", n_nuevos == 5, "(%d)" % n_nuevos)
    check("delta: discrepancias == 1", n_discr == 1, "(%d)" % n_discr)
    check("delta: duplicados == %d" % (len(vivos) - 6), n_dup == len(vivos) - 6, "(%d)" % n_dup)
    check("delta: faltantes == 0", n_falt == 0, "(%d)" % n_falt)

    # candidatos.csv (handoff): la clasificacion delta debe reflejarse ahi
    with open(SESION / "out" / "candidatos.csv", encoding="utf-8-sig", newline="") as fh:
        cands = list(csv.DictReader(fh))
    conteo = {}
    for c in cands:
        conteo[c["clasificacion"]] = conteo.get(c["clasificacion"], 0) + 1
    print("[i] candidatos.csv: %d filas, clasificacion=%s" % (len(cands), conteo))
    check("candidatos: nuevo == 5", conteo.get("nuevo", 0) == 5, "(%d)" % conteo.get("nuevo", 0))
    check("candidatos: duplicado == %d" % (len(vivos) - 6),
          conteo.get("duplicado", 0) == len(vivos) - 6, "(%d)" % conteo.get("duplicado", 0))
    check("candidatos: discrepancia == 1", conteo.get("discrepancia", 0) == 1,
          "(%d)" % conteo.get("discrepancia", 0))
    check("candidatos: ambiguous == 0", conteo.get("ambiguous", 0) == 0,
          "(%d)" % conteo.get("ambiguous", 0))
    check("candidatos: sin_comparar == 0", conteo.get("sin_comparar", 0) == 0,
          "(%d)" % conteo.get("sin_comparar", 0))
    n_desc = conteo.get("descartado", 0)
    check("candidatos: total == vivos + descartados",
          len(cands) == len(vivos) + n_desc, "(%d vs %d+%d)" % (len(cands), len(vivos), n_desc))

    print()
    if FALLOS:
        print("RESULTADO: FAIL (%s)" % ", ".join(FALLOS))
        sys.exit(1)
    print("RESULTADO: PASS — %d/%d viajes recuperados, sin fantasmas, delta exacto, "
          "handoff candidatos.csv consistente." % (len(matched), len(T)))


if __name__ == "__main__":
    main()
