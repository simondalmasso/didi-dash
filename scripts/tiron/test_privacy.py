import unittest
from PIL import Image, ImageDraw
import tiron


def item(text, x1, y1, x2, y2):
    return {"text": text, "conf": 0.99, "x1": x1, "y1": y1, "x2": x2, "y2": y2}


class PrivacyTests(unittest.TestCase):
    def test_ocr_persists_only_whitelisted_trip_fields(self):
        sanitize = getattr(tiron, "sanitize_ocr_items", None)
        self.assertTrue(callable(sanitize), "TIRON lacks an OCR persistence allowlist")

        raw = [
            item("sábado 14 de noviembre", 10, 10, 190, 35),
            item("DiDi Express", 10, 50, 100, 75),
            item("18:42", 110, 50, 160, 75),
            item("$8.400", 170, 50, 230, 75),
            item("Av. Aristóbulo del Valle 4761", 10, 90, 210, 115),
            item("+54 9 342 555 1212", 10, 120, 200, 145),
            item("3,4 km · 12 min", 10, 150, 150, 175),
            item("Destino: Alta Vista Disco", 10, 180, 210, 205),
            item("Av. 14 de noviembre 123", 10, 210, 210, 235),
        ]
        safe = sanitize(raw)
        texts = [x["text"] for x in safe]
        self.assertEqual(texts, [
            "sábado 14 de noviembre",
            "DiDi Express",
            "18:42",
            "$8.400",
            "3,4 km · 12 min",
        ])
        serialized = repr(safe)
        self.assertNotIn("Aristóbulo", serialized)
        self.assertNotIn("555", serialized)
        self.assertNotIn("Alta Vista", serialized)
        self.assertNotIn("Av. 14 de noviembre 123", serialized)

    def test_redacted_frame_restores_only_allowlisted_text_regions(self):
        redact = getattr(tiron, "redact_image", None)
        self.assertTrue(callable(redact), "TIRON lacks in-memory frame redaction")

        source = Image.new("RGB", (240, 160), "black")
        draw = ImageDraw.Draw(source)
        draw.rectangle((10, 10, 50, 30), fill="white")   # permitted time/amount region
        draw.rectangle((150, 80, 220, 115), fill="white") # address-shaped region
        safe = [item("18:42", 10, 10, 50, 30)]
        redacted = redact(source, safe)
        self.assertEqual(redacted.size, source.size)
        self.assertEqual(redacted.getpixel((25, 20)), source.getpixel((25, 20)))
        self.assertNotEqual(redacted.getpixel((180, 95)), source.getpixel((180, 95)))


    def test_ocr_reprocesses_old_cache_and_blurs_input_before_persisting(self):
        import json
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch

        source = Image.new("RGB", (240, 160), "black")
        draw = ImageDraw.Draw(source)
        draw.rectangle((10, 10, 50, 30), fill="white")
        draw.rectangle((150, 80, 220, 115), fill="white")
        ocr_items = [
            item("18:42", 10, 10, 50, 30),
            item("Av. Aristóbulo del Valle 4761", 150, 80, 220, 115),
            item("+54 9 342 555 1212", 150, 120, 220, 145),
        ]

        with tempfile.TemporaryDirectory() as temp:
            session = Path(temp)
            frames = session / "frames"
            ocr_dir = session / "ocr"
            frames.mkdir()
            ocr_dir.mkdir()
            frame = frames / "frame_0001.png"
            source.save(frame)
            cached = ocr_dir / "frame_0001.json"
            cached.write_text(
                json.dumps({"frame": frame.name, "items": [{"text": "old address"}]}),
                encoding="utf-8",
            )

            with patch.object(tiron, "make_engine", return_value=lambda image: ocr_items):
                tiron.cmd_ocr(SimpleNamespace(sesion=temp, force=False))

            payload = json.loads(cached.read_text(encoding="utf-8"))
            serialized = json.dumps(payload, ensure_ascii=False)
            self.assertTrue(payload.get("redacted"))
            self.assertNotIn("Aristóbulo", serialized)
            self.assertNotIn("555", serialized)
            self.assertNotIn("old address", serialized)
            self.assertEqual([x["text"] for x in payload["items"]], ["18:42"])

            saved = Image.open(frame).convert("RGB")
            self.assertEqual(saved.getpixel((25, 20)), source.getpixel((25, 20)))
            self.assertNotEqual(saved.getpixel((180, 95)), source.getpixel((180, 95)))


    def test_ocr_failure_cannot_leave_raw_frame_or_old_json(self):
        import json
        import tempfile
        from pathlib import Path
        from types import SimpleNamespace
        from unittest.mock import patch

        source = Image.new("RGB", (240, 160), "black")
        ImageDraw.Draw(source).rectangle((150, 80, 220, 115), fill="white")
        with tempfile.TemporaryDirectory() as temp:
            frames = Path(temp) / "frames"
            ocr_dir = Path(temp) / "ocr"
            frames.mkdir()
            ocr_dir.mkdir()
            frame = frames / "frame_0001.png"
            source.save(frame)
            cached = ocr_dir / "frame_0001.json"
            cached.write_text(
                json.dumps({"items": [{"text": "Av. Aristóbulo del Valle 4761"}]}),
                encoding="utf-8",
            )

            def fail_engine(image):
                raise RuntimeError("synthetic OCR failure")

            with patch.object(tiron, "make_engine", return_value=fail_engine):
                with self.assertRaises(RuntimeError):
                    tiron.cmd_ocr(SimpleNamespace(sesion=temp, force=False))

            self.assertFalse(cached.exists(), "stale OCR JSON must be removed before processing")
            saved = Image.open(frame).convert("RGB")
            self.assertEqual(saved.getpixel((180, 95)), (24, 24, 24))


    def test_numeric_12_hour_timestamp_is_safe_and_drives_card_date_time(self):
        timestamp = item("14/11/2026, 8:54 pm", 40, 100, 260, 130)
        modality = item("Express", 80, 155, 190, 185)
        amount = item("$3.900", 510, 155, 650, 185)

        safe = tiron.sanitize_ocr_items([timestamp, modality, amount])
        self.assertEqual([x["text"] for x in safe], [
            "14/11/2026, 8:54 pm", "Express", "$3.900"
        ])

        events, unparsed, _ = tiron.procesar_frame(tiron.items_con_geom({"items": safe}))
        self.assertEqual(unparsed, [])
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["kind"], "card")
        self.assertEqual(events[0]["token"], "2026-11-14")
        self.assertEqual(events[0]["hora"], "20:54")
        self.assertEqual(events[0]["monto_digits"], 3900)
        self.assertEqual(events[0]["tipo"], "Express")

if __name__ == "__main__":
    unittest.main()
