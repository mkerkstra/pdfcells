"""Generate the PDF test corpus. Each fixture targets one way real-world PDFs go wrong.

uv run --with reportlab --with pillow --with pypdfium2 --with numpy python fixtures/make_fixtures.py fixtures

Every fixture also writes its ground truth to fixtures/truth/<file>.json: per
page, the document type and the tables a perfect extractor returns, as cell
grids of the exact printed strings. The truth is recorded from the same values
the drawing code prints (see Truth below), never written by hand. The eval
harness (eval/) scores engines against it; src/corpus.test.ts keeps its own
hand-written expectations. Regenerating is deterministic (fixed seeds).
"""

import io
import json
import random
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFilter
from reportlab.lib.pagesizes import landscape, letter, A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
FONTS = Path("/System/Library/Fonts/Supplemental")
pdfmetrics.registerFont(TTFont("ArialUni", str(FONTS / "Arial Unicode.ttf")))


def money(v: float, parens=True, comma_decimal=False) -> str:
    s = f"{abs(v):,.2f}"
    if comma_decimal:
        s = s.replace(",", "_").replace(".", ",").replace("_", ".")
    if v < 0:
        return f"({s})" if parens else f"-{s}"
    return s


# ---------------------------------------------------------------- ground truth
# Conventions (see fixtures/README.md):
# - a cell is the exact printed string; text wrapped over several lines inside
#   one cell is joined with single spaces;
# - a cell spanning several columns or rows holds its text in the top-left cell
#   and "" in the rest; the span itself is listed in "spans" as [row, col, rows, cols];
# - totals lines printed on a table's own column grid are that table's last rows;
#   key-value blocks are two-column tables; a section label is a row with the
#   label in column 0;
# - page headers/footers, captions, prose, charts, tables of contents and
#   marketing blocks are not tables.
DOC_TYPES = {"statement", "invoice", "report", "form", "text", "blank"}


class Table:
    def __init__(self, title="", header_rows=1):
        self.title = title
        self.header_rows = header_rows
        self.rows: list[list[str]] = []
        self.spans: list[list[int]] = []

    def row(self, cells):
        self.rows.append([str(c) for c in cells])
        return len(self.rows) - 1

    def span(self, row, col, rows, cols):
        self.spans.append([row, col, rows, cols])

    def json(self):
        width = max(len(r) for r in self.rows)
        t = {"title": self.title, "headerRows": self.header_rows, "rows": [r + [""] * (width - len(r)) for r in self.rows]}
        if self.spans:
            t["spans"] = self.spans
        return t


class Truth:
    """Ground truth for one fixture file, built while the file is drawn."""

    def __init__(self, source="digital", password=None):
        assert source in {"digital", "scan", "photo", "image"}
        self.source = source
        self.password = password
        self.pages: list[dict] = []

    def page(self, doc_type):
        assert doc_type in DOC_TYPES
        self.pages.append({"type": doc_type, "tables": []})
        return self

    def table(self, title="", header_rows=1):
        t = Table(title, header_rows)
        self.pages[-1]["tables"].append(t)
        return t

    def write(self, filename):
        d = out / "truth"
        d.mkdir(parents=True, exist_ok=True)
        doc = {"file": filename, "source": self.source}
        if self.password:
            doc["password"] = self.password
        doc["pages"] = [{"type": p["type"], "tables": [t.json() for t in p["tables"]]} for p in self.pages]
        # One grid row (and one span) per line keeps the files reviewable.
        inline: list[str] = []

        def mark(xs):
            inline.append(json.dumps(xs, ensure_ascii=False))
            return f"@@{len(inline) - 1}@@"

        for p in doc["pages"]:
            for t in p["tables"]:
                t["rows"] = [mark(r) for r in t["rows"]]
                if "spans" in t:
                    t["spans"] = [mark(s) for s in t["spans"]]
        text = json.dumps(doc, indent=1, ensure_ascii=False)
        for i, s in enumerate(inline):
            text = text.replace(f'"@@{i}@@"', s, 1)
        path = d / f"{filename}.json"
        path.parent.mkdir(parents=True, exist_ok=True)  # batch/ fixtures
        path.write_text(text + "\n")


# ---------------------------------------------------------------- statement
def statement():
    """Two-page bank statement: repeated header, page footers, summary table on p2."""
    random.seed(7)
    truth = Truth()
    c = canvas.Canvas(str(out / "statement.pdf"), pagesize=letter)
    cols = [50, 130, 380, 470]
    rows, bal = [], 1000.00
    for i in range(1, 46):
        amt = round(random.uniform(-250, 400), 2)
        bal = round(bal + amt, 2)
        rows.append((f"03/{(i % 28) + 1:02d}/2026", f"Payment ref {1000 + i}" + (" ACME CORP" if i % 5 == 0 else ""), amt, bal))
    heads = ["Date", "Description", "Amount", "Balance"]

    def header(y, t):
        c.setFont("Helvetica-Bold", 10)
        for x, h in zip(cols, heads):
            c.drawString(x, y, h)
        t.row(heads)

    def rowline(y, r, t):
        cells = [r[0], r[1], money(r[2]), money(r[3])]
        c.setFont("Helvetica", 10)
        c.drawString(cols[0], y, cells[0])
        c.drawString(cols[1], y, cells[1])
        c.drawRightString(cols[2] + 60, y, cells[2])
        c.drawRightString(cols[3] + 70, y, cells[3])
        t.row(cells)

    truth.page("statement")
    t = truth.table()
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, 740, "Riverbank Checking - March 2026")
    c.setFont("Helvetica", 10)
    c.drawString(50, 722, "Account 00012345 - statement period 03/01/2026 to 03/31/2026")
    y = 690
    header(y, t)
    y -= 16
    for r in rows[:30]:
        rowline(y, r, t)
        y -= 15
    c.drawString(50, 40, "Page 1 of 2")
    c.showPage()
    truth.page("statement")
    t = truth.table()
    y = 740
    header(y, t)
    y -= 16
    for r in rows[30:]:
        rowline(y, r, t)
        y -= 15
    y -= 30
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, y, "Summary")
    t = truth.table("Summary", header_rows=0)
    y -= 18
    summary = [("Opening balance", 1000.00), ("Deposits", sum(r[2] for r in rows if r[2] > 0)), ("Withdrawals", sum(r[2] for r in rows if r[2] < 0))]
    c.setFont("Helvetica", 10)
    for label, v in summary:
        c.drawString(50, y, label)
        c.drawRightString(300, y, money(v, parens=False))
        t.row([label, money(v, parens=False)])
        y -= 15
    c.drawString(50, 40, "Page 2 of 2")
    c.save()
    truth.write("statement.pdf")


# ---------------------------------------------------------------- invoice (vector, for scans)
def invoice_vector(path: Path) -> Table:
    """The invoice every scan, photo and image fixture shows; returns its table."""
    t = Table()
    c = canvas.Canvas(str(path), pagesize=letter)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(50, 730, "INVOICE #4471")
    c.setFont("Helvetica", 11)
    c.drawString(50, 710, "Northwind Supplies   Due: April 15, 2026")
    items = [("Steel brackets", 120, 2.35), ("Hex bolts M8", 800, 0.12), ("Anchor plates", 40, 14.50), ("Freight", 1, 85.00)]
    x = [50, 300, 380, 470]
    y = 660
    c.setFont("Helvetica-Bold", 11)
    heads = ["Item", "Qty", "Unit", "Total"]
    for xx, h in zip(x, heads):
        c.drawString(xx, y, h)
    t.row(heads)
    c.line(50, y - 5, 540, y - 5)
    c.setFont("Helvetica", 11)
    tot = 0
    for name, q, u in items:
        y -= 20
        tt = q * u
        tot += tt
        cells = [name, str(q), f"{u:,.2f}", f"{tt:,.2f}"]
        c.drawString(x[0], y, cells[0])
        c.drawRightString(x[1] + 30, y, cells[1])
        c.drawRightString(x[2] + 50, y, cells[2])
        c.drawRightString(x[3] + 60, y, cells[3])
        t.row(cells)
    y -= 25
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x[0], y, "Total")
    c.drawRightString(x[3] + 60, y, f"{tot:,.2f}")
    t.row(["Total", "", "", f"{tot:,.2f}"])
    c.save()
    return t


def invoice_truth(filename: str, source: str, table: Table, pages=1):
    truth = Truth(source)
    for _ in range(pages):
        truth.page("invoice").pages[-1]["tables"].append(table)
    truth.write(filename)


def render(path: Path, dpi: int) -> Image.Image:
    return pdfium.PdfDocument(str(path))[0].render(scale=dpi / 72).to_pil().convert("L")


def noise(img: Image.Image, amount: int, seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    a = np.asarray(img, dtype=np.int16)
    a = a + rng.normal(0, amount, a.shape).astype(np.int16)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def image_pdf(img: Image.Image, path: Path, dpi: int, quality: int):
    img.convert("RGB").save(str(path), resolution=dpi, quality=quality)


def scans():
    vec = out / "_invoice_vector.pdf"
    inv = invoice_vector(vec)

    # Clean office scan: 200 dpi, slight skew, light noise.
    img = render(vec, 200).rotate(0.8, fillcolor=255, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.6))
    image_pdf(noise(img, 18, 3), out / "scanned-invoice.pdf", 200, 70)
    invoice_truth("scanned-invoice.pdf", "scan", inv)

    # Bad fax-grade scan: 110 dpi, 2.5° skew, heavy noise, crushed JPEG.
    img = render(vec, 110).rotate(2.5, fillcolor=245, resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(0.9))
    img = noise(img, 45, 4).point(lambda p: 255 if p > 150 else int(p * 0.6))
    image_pdf(img, out / "scanned-bad.pdf", 110, 25)
    invoice_truth("scanned-bad.pdf", "scan", inv)

    # Phone photo: perspective warp, uneven lighting, warm tint, on a desk.
    src = render(vec, 150).convert("RGB")
    w, h = src.size
    coeffs = _perspective_coeffs([(0, 0), (w, 0), (w, h), (0, h)], [(60, 40), (w - 20, 90), (w - 90, h - 30), (10, h - 80)])
    warped = src.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(92, 74, 58))
    shade = Image.linear_gradient("L").resize((w, h)).rotate(35, expand=False)
    warped = Image.composite(warped, Image.new("RGB", (w, h), (70, 60, 50)), shade.point(lambda p: 150 + p * 105 // 255))
    tint = Image.new("RGB", (w, h), (255, 236, 205))
    warped = Image.blend(warped, tint, 0.12).filter(ImageFilter.GaussianBlur(0.8))
    warped.save(str(out / "photo-invoice.pdf"), resolution=150, quality=60)
    invoice_truth("photo-invoice.pdf", "photo", inv)

    # Scan whose hidden OCR text layer is garbage (broken font encoding).
    img = render(vec, 150)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=70)
    c = canvas.Canvas(str(out / "broken-text-layer.pdf"), pagesize=letter)
    from reportlab.lib.utils import ImageReader

    c.drawImage(ImageReader(io.BytesIO(buf.getvalue())), 0, 0, width=letter[0], height=letter[1])
    t = c.beginText(50, 700)
    t.setTextRenderMode(3)  # invisible, like an OCR layer
    t.setFont("ArialUni", 11)
    rng = random.Random(9)
    for _ in range(30):
        t.textLine("".join(chr(0xE000 + rng.randrange(400)) if rng.random() > 0.15 else " " for _ in range(48)))
    c.drawText(t)
    c.save()
    invoice_truth("broken-text-layer.pdf", "scan", inv)
    vec.unlink()


# ---------------------------------------------------------------- images (not PDFs)
def images():
    """Photos, screenshots and multi-page TIFFs: every page is read from the image."""
    vec = out / "_invoice_vector.pdf"
    inv = invoice_vector(vec)
    page = render(vec, 150).filter(ImageFilter.GaussianBlur(0.5))
    vec.unlink()

    # Plain PNG of a scanned page.
    page.save(str(out / "scanned-invoice.png"), optimize=True)
    invoice_truth("scanned-invoice.png", "image", inv)

    # Two-page grayscale TIFF (LZW): the clean page, then a slightly skewed copy.
    p2 = page.rotate(1.2, fillcolor=255, resample=Image.BICUBIC)
    page.save(str(out / "scanned-invoice-2p.tiff"), save_all=True, append_images=[p2], compression="tiff_lzw", dpi=(150, 150))
    invoice_truth("scanned-invoice-2p.tiff", "image", inv, pages=2)

    # Phone JPEG stored sideways with EXIF Orientation=6 (display = rotate 90° clockwise).
    photo = page.convert("RGB").rotate(90, expand=True)
    exif = Image.Exif()
    exif[0x0112] = 6
    photo.save(str(out / "photo-rotated.jpg"), quality=80, exif=exif.tobytes())
    invoice_truth("photo-rotated.jpg", "photo", inv)

    # Screenshot-sized crop of the table, as GIF and lossless WebP. The crop
    # keeps the whole table (it cuts only into the title above it).
    shot = page.crop((80, 120, 1180, 760)).convert("RGB")
    shot.convert("P", palette=Image.ADAPTIVE, colors=64).save(str(out / "screenshot.gif"))
    shot.save(str(out / "screenshot.webp"), lossless=True)
    invoice_truth("screenshot.gif", "image", inv)
    invoice_truth("screenshot.webp", "image", inv)

    # HEIC needs an encoder Pillow doesn't ship; macOS sips makes one (not byte-deterministic).
    import shutil
    import subprocess

    if shutil.which("sips"):
        subprocess.run(["sips", "-s", "format", "heic", str(out / "scanned-invoice.png"), "--out", str(out / "scanned-invoice.heic")], check=True, capture_output=True)
    invoice_truth("scanned-invoice.heic", "image", inv)


def _perspective_coeffs(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(m, dtype=float)
    b = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(a, b).tolist()


# ---------------------------------------------------------------- ruled + wrapped
def ruled_wrapped():
    """Grid-lined table with wrapped multi-line description cells."""
    truth = Truth().page("report")
    c = canvas.Canvas(str(out / "ruled-wrapped.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 740, "Change orders - Building C")
    t = truth.table("Change orders - Building C")
    rows = [
        ("CO-101", "Relocate electrical panel to north wall per revised drawing E-3, including new conduit runs", "4,250.00", "Approved"),
        ("CO-102", "Add two skylights", "7,800.00", "Pending"),
        ("CO-103", "Upgrade lobby flooring from vinyl to porcelain tile; owner-supplied grout", "12,410.50", "Approved"),
        ("CO-104", "Credit for deleted canopy", "(3,000.00)", "Approved"),
        ("CO-105", "Fire sprinkler head relocation at mezzanine, coordinate with HVAC duct reroute and ceiling grid", "2,975.25", "Rejected"),
    ]
    xs = [50, 120, 400, 490, 562]
    y = 715
    heights = []
    c.setFont("Helvetica", 9.5)
    wrapped = []
    for r in rows:
        lines = _wrap(r[1], 270, "Helvetica", 9.5)
        wrapped.append(lines)
        heights.append(max(1, len(lines)) * 12 + 8)
    c.setLineWidth(0.6)
    total_h = 20 + sum(heights)
    for x in xs:
        c.line(x, y, x, y - total_h)
    c.line(xs[0], y, xs[-1], y)
    c.setFont("Helvetica-Bold", 9.5)
    heads = ["No.", "Description", "Amount", "Status"]
    for x, h in zip(xs, heads):
        c.drawString(x + 5, y - 14, h)
    t.row(heads)
    y -= 20
    c.line(xs[0], y, xs[-1], y)
    c.setFont("Helvetica", 9.5)
    for r, lines, hgt in zip(rows, wrapped, heights):
        c.drawString(xs[0] + 5, y - 13, r[0])
        for i, ln in enumerate(lines):
            c.drawString(xs[1] + 5, y - 13 - i * 12, ln)
        c.drawRightString(xs[3] - 6, y - 13, r[2])
        c.drawString(xs[3] + 5, y - 13, r[3])
        t.row([r[0], " ".join(lines), r[2], r[3]])
        y -= hgt
        c.line(xs[0], y, xs[-1], y)
    c.save()
    truth.write("ruled-wrapped.pdf")


def _wrap(text, width, font, size):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(trial, font, size) > width:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


# ---------------------------------------------------------------- EU invoice
def eu_invoice():
    """Decimal commas, € suffix, DD.MM.YYYY dates, key-value block, A4."""
    truth = Truth().page("invoice")
    c = canvas.Canvas(str(out / "eu-invoice.pdf"), pagesize=A4)
    W, H = A4
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, H - 70, "Rechnung")
    c.setFont("Helvetica", 10)
    kv = [("Rechnungsnummer", "RE-2026-0412"), ("Rechnungsdatum", "03.04.2026"), ("Kundennummer", "004711"), ("Fällig am", "17.04.2026")]
    t = truth.table(header_rows=0)
    y = H - 100
    for k, v in kv:
        c.drawString(50, y, k)
        c.drawString(170, y, v)
        t.row([k, v])
        y -= 14
    items = [("Beratung", "8,0", "Std.", 120.00), ("Lizenz Jahresabo", "1", "Stk.", 1490.00), ("Schulung vor Ort", "2,5", "Tage", 850.00), ("Reisekosten", "1", "pausch.", 312.40)]
    y -= 30
    xs = [50, 260, 320, 400, 545]
    c.setFont("Helvetica-Bold", 10)
    t = truth.table()
    for x, h in zip(xs[:3], ["Position", "Menge", "Einheit"]):
        c.drawString(x, y, h)
    c.drawRightString(470, y, "Einzelpreis")
    c.drawRightString(545, y, "Gesamt")
    t.row(["Position", "Menge", "Einheit", "Einzelpreis", "Gesamt"])
    c.setFont("Helvetica", 10)
    net = 0.0
    for name, qty, unit, price in items:
        y -= 16
        q = float(qty.replace(",", "."))
        tot = q * price
        net += tot
        cells = [name, qty, unit, money(price, comma_decimal=True) + " €", money(tot, comma_decimal=True) + " €"]
        c.drawString(xs[0], y, cells[0])
        c.drawRightString(300, y, cells[1])
        c.drawString(xs[2], y, cells[2])
        c.drawRightString(470, y, cells[3])
        c.drawRightString(545, y, cells[4])
        t.row(cells)
    y -= 26
    vat = round(net * 0.19, 2)
    for label, v in [("Nettobetrag", net), ("USt. 19 %", vat), ("Gesamtbetrag", net + vat)]:
        # The label sits in the Einheit column, the amount under Gesamt.
        c.drawString(320, y, label)
        c.drawRightString(545, y, money(v, comma_decimal=True) + " €")
        t.row(["", "", label, "", money(v, comma_decimal=True) + " €"])
        y -= 15
    c.save()
    truth.write("eu-invoice.pdf")


# ---------------------------------------------------------------- financial report
def financial_report():
    """Landscape P&L: two-level header, sections, subtotals, %, dashes, footnotes."""
    truth = Truth().page("report")
    t = truth.table(header_rows=2)
    c = canvas.Canvas(str(out / "financial-report.pdf"), pagesize=landscape(letter))
    W, H = landscape(letter)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(50, H - 55, "Consolidated statement of operations")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 70, "(in thousands of USD, except per-share data)")
    cols = [330, 400, 470, 540, 630, 700]
    y = H - 105
    c.setFont("Helvetica-Bold", 9.5)
    c.drawCentredString((cols[0] + cols[3]) / 2 + 20, y, "Three months ended")
    c.drawCentredString((cols[4] + cols[5]) / 2 + 20, y, "Change")
    t.row(["", "Three months ended", "", "", "", "Change", ""])
    t.span(0, 1, 1, 4)
    t.span(0, 5, 1, 2)
    c.line(cols[0] - 10, y - 4, cols[3] + 50, y - 4)
    y -= 16
    heads = ["Mar 31, 2026", "Dec 31, 2025", "Sep 30, 2025", "Jun 30, 2025", "QoQ %", "YoY %"]
    for x, h in zip(cols, heads):
        c.drawRightString(x + 50, y, h)
    t.row(["", *heads])
    revenue = [("Subscription", [41210, 38904, 36120, 33980]), ("Professional services", [3105, 3420, 2980, 3002]), ("Hardware¹", [1220, 0, 0, 0])]
    costs = [("Cost of revenue", [-14102, -13350, -12406, -11920]), ("Research and development", [-9830, -9411, -9002, -8770]), ("Sales and marketing", [-11204, -10660, -10115, -9905]), ("General and administrative", [-4420, -4198, -4012, -3990])]

    def line(label, vals, bold=False):
        nonlocal y
        y -= 15
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 9.5)
        c.drawString(60 if not bold else 50, y, label)
        cells = [label]
        for x, v in zip(cols, vals):
            s = "—" if v == 0 else f"({abs(v):,})" if v < 0 else f"{v:,}"
            c.drawRightString(x + 50, y, s)
            cells.append(s)
        q = (vals[0] - vals[1]) / abs(vals[1]) * 100 if vals[1] else None
        yoy = (vals[0] - vals[3]) / abs(vals[3]) * 100 if vals[3] else None
        for x, p in zip(cols[4:], [q, yoy]):
            s = "n/m" if p is None else f"{p:.1f}%"
            c.drawRightString(x + 50, y, s)
            cells.append(s)
        t.row(cells)

    def section(label):
        nonlocal y
        y -= 8
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(50, y - 15, label)
        t.row([label])
        y -= 15

    section("Revenue")
    for l, v in revenue:
        line(l, v)
    rev_tot = [sum(v[i] for _, v in revenue) for i in range(4)]
    line("Total revenue", rev_tot, bold=True)
    section("Operating expenses")
    for l, v in costs:
        line(l, v)
    cost_tot = [sum(v[i] for _, v in costs) for i in range(4)]
    line("Total operating expenses", cost_tot, bold=True)
    y -= 6
    line("Operating income", [a + b for a, b in zip(rev_tot, cost_tot)], bold=True)
    y -= 30
    c.setFont("Helvetica", 8)
    c.drawString(50, y, "¹ Hardware sales began in Q1 2026 following the Lumen acquisition.")
    c.save()
    truth.write("financial-report.pdf")


# ---------------------------------------------------------------- mixed document
def mixed():
    """Prose page, blank page, a table page, and a /Rotate 90 page with a table."""
    truth = Truth().page("text").page("blank").page("report")
    c = canvas.Canvas(str(out / "mixed-document.pdf"), pagesize=letter)
    c.setFont("Times-Roman", 12)
    t = c.beginText(72, 700)
    para = ("This quarterly letter summarises operating results and outlook. Readers should refer to the "
            "attached schedules for detail. Nothing on this page is tabular; a converter should find no "
            "tables here and should not invent any from ordinary paragraphs of text.")
    for ln in _wrap(para * 3, 460, "Times-Roman", 12):
        t.textLine(ln)
    c.drawText(t)
    c.showPage()
    c.showPage()  # blank
    c.setFont("Helvetica-Bold", 12)
    c.drawString(72, 700, "Headcount by office")
    tt = truth.table("Headcount by office")
    data = [("Office", "Engineering", "Sales", "Total"), ("Austin", "84", "22", "106"), ("Dublin", "41", "18", "59"), ("Singapore", "12", "15", "27"), ("Total", "137", "55", "192")]
    y = 675
    for i, r in enumerate(data):
        c.setFont("Helvetica-Bold" if i in (0, len(data) - 1) else "Helvetica", 10)
        c.drawString(72, y, r[0])
        for x, v in zip([300, 380, 460], r[1:]):
            c.drawRightString(x, y, v)
        tt.row(r)
        y -= 15
    c.showPage()
    # Landscape content on a portrait page, rotated by the /Rotate key.
    # Viewers turn the page 90° clockwise, so draw the content turned 90°
    # counter-clockwise: landscape coordinates (u, v) map to (W - v, u).
    # ReportLab swaps the media box when rotating, so ask for landscape to end
    # up with a portrait (612x792) box plus /Rotate 90, as scanners produce.
    truth.page("report")
    c.setPageSize(landscape(letter))
    c.setPageRotation(90)
    c.saveState()
    c.translate(letter[0], 0)
    c.rotate(90)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(60, letter[0] - 80, "Inventory by warehouse")
    tt = truth.table("Inventory by warehouse")
    y = letter[0] - 105
    for i, r in enumerate([("SKU", "Reno", "Columbus", "Total"), ("A-100", "1,200", "800", "2,000"), ("A-200", "340", "1,020", "1,360"), ("B-310", "75", "0", "75")]):
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 10)
        c.drawString(60, y, r[0])
        for x, v in zip([300, 420, 540], r[1:]):
            c.drawRightString(x, y, v)
        tt.row(r)
        y -= 15
    c.restoreState()
    c.save()
    truth.write("mixed-document.pdf")


# ---------------------------------------------------------------- dense + wide
def dense_wide():
    """Landscape, 12 columns, 55 rows, 6.5pt: IDs with leading zeros, %, dates."""
    random.seed(11)
    truth = Truth().page("report")
    t = truth.table()
    c = canvas.Canvas(str(out / "dense-wide.pdf"), pagesize=landscape(letter))
    W, H = landscape(letter)
    heads = ["Store", "Region", "Opened", "Q1", "Q2", "Q3", "Q4", "FY", "Margin", "Staff", "Sq ft", "Rating"]
    xs = [30, 70, 125, 205, 260, 315, 370, 435, 490, 535, 590, 640]
    right = {3, 4, 5, 6, 7, 8, 9, 10, 11}
    c.setFont("Helvetica-Bold", 7)
    y = H - 40
    for i, (x, h) in enumerate(zip(xs, heads)):
        (c.drawRightString if i in right else c.drawString)(x + (40 if i in right else 0), y, h)
    t.row(heads)
    c.setFont("Helvetica", 6.5)
    for n in range(55):
        y -= 9.6
        q = [random.randint(80, 900) * 1000 for _ in range(4)]
        vals = [f"{n + 7:05d}", random.choice(["West", "East", "Central", "South"]), f"{random.randint(2009, 2025)}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}",
                *[f"{v:,}" for v in q], f"{sum(q):,}", f"{random.uniform(-4, 22):.1f}%", str(random.randint(8, 60)), f"{random.randint(9, 60) * 100:,}", f"{random.uniform(2.5, 5):.1f}"]
        for i, (x, v) in enumerate(zip(xs, vals)):
            (c.drawRightString if i in right else c.drawString)(x + (40 if i in right else 0), y, v)
        t.row(vals)
    c.save()
    truth.write("dense-wide.pdf")


# ---------------------------------------------------------------- side by side
def side_by_side():
    """Two independent tables next to each other on one page."""
    truth = Truth().page("report")
    c = canvas.Canvas(str(out / "side-by-side.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, 720, "Top customers")
    c.drawString(330, 720, "Top products")
    left = [("Customer", "Revenue"), ("Contoso", "182,400"), ("Fabrikam", "121,050"), ("Tailspin", "98,700"), ("Wingtip", "64,300")]
    rightt = [("Product", "Units"), ("Widget Pro", "8,120"), ("Widget Lite", "6,904"), ("Gizmo", "2,330"), ("Doohickey", "1,215")]
    tl, tr = truth.table("Top customers"), truth.table("Top products")
    y = 698
    for i, (a, b) in enumerate(zip(left, rightt)):
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 10)
        c.drawString(50, y, a[0])
        c.drawRightString(260, y, a[1])
        c.drawString(330, y, b[0])
        c.drawRightString(540, y, b[1])
        tl.row(a)
        tr.row(b)
        y -= 15
    c.save()
    truth.write("side-by-side.pdf")


# ---------------------------------------------------------------- no header, ids
def no_header():
    """Headerless export: zero-padded IDs, mixed date formats, trailing-minus negatives."""
    truth = Truth().page("report")
    t = truth.table(header_rows=0)
    c = canvas.Canvas(str(out / "no-header-ids.pdf"), pagesize=letter)
    rows = [("000123", "2026-01-04", "Widget refill", "12.50"), ("000124", "01/05/2026", "Adapter", "8.00"), ("000125", "Jan 6, 2026", "Return - adapter", "8.00-"), ("000126", "2026-01-07", "Cable 2m", "4.75"), ("000127", "2026-01-09", "Widget refill", "12.50")]
    y = 720
    c.setFont("Courier", 10)
    for r in rows:
        c.drawString(50, y, r[0])
        c.drawString(130, y, r[1])
        c.drawString(230, y, r[2])
        c.drawRightString(470, y, r[3])
        t.row(r)
        y -= 14
    c.save()
    truth.write("no-header-ids.pdf")


# ---------------------------------------------------------------- password
def protected():
    """Password-protected (user password 'pdfcells')."""
    truth = Truth(password="pdfcells").page("report")
    t = truth.table()
    c = canvas.Canvas(str(out / "protected.pdf"), pagesize=letter, encrypt="pdfcells")
    c.setFont("Helvetica", 11)
    y = 700
    for r in [("Item", "Qty"), ("Secret sauce", "3"), ("Hidden gem", "7")]:
        c.drawString(72, y, r[0])
        c.drawRightString(300, y, r[1])
        t.row(r)
        y -= 16
    c.save()
    truth.write("protected.pdf")


# ---------------------------------------------------------------- accuracy cross-checks
# The fixtures below plant exactly one arithmetic error each (or none, for the
# clean variants) so the deterministic checks in src/lib/checks/ can be held to
# the exact cell. invariant=1 keeps their bytes stable across regenerations.
# Their truth is what is printed, planted error included.
def statement_dc(plant: bool):
    """Debit/credit/balance statement; the misread variant prints one debit with a wrong digit."""
    name = "statement-dc-misread.pdf" if plant else "statement-dc.pdf"
    _statement_dc(name, seed=21, month=5, last_day=31, opening=2450.00, plant=plant)


def _statement_dc(name: str, seed: int, month: int, last_day: int, opening: float, plant: bool):
    truth = Truth().page("statement")
    t = truth.table()
    rng = random.Random(seed)
    c = canvas.Canvas(str(out / name), pagesize=letter, invariant=1)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(50, 740, "Harbor Credit Union - Share draft account")
    c.setFont("Helvetica", 9.5)
    c.drawString(50, 724, f"Statement period {month:02d}/01/2026 to {month:02d}/{last_day:02d}/2026")
    xs = [50, 115, 330, 410, 500]
    y = 690
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(xs[0], y, "Date")
    c.drawString(xs[1], y, "Description")
    for x, h in zip(xs[2:], ["Debit", "Credit", "Balance"]):
        c.drawRightString(x + 60, y, h)
    t.row(["Date", "Description", "Debit", "Credit", "Balance"])
    bal = opening
    debits = credits = 0.0
    c.setFont("Helvetica", 9.5)
    for i in range(18):
        y -= 15
        credit = i % 4 == 1
        amt = round(rng.uniform(150, 1200) if credit else rng.uniform(8, 400), 2)
        bal = round(bal + (amt if credit else -amt), 2)
        if credit:
            credits += amt
        else:
            debits += amt
        shown = amt
        if plant and i == 9:
            shown = round(amt + 5, 2)  # one digit misread, e.g. 82.51 -> 87.51
        date, desc, amount, balance = f"{month:02d}/{i + 2:02d}/2026", ("Payroll deposit" if credit else f"Card purchase {4100 + i}"), f"{shown:,.2f}", f"{bal:,.2f}"
        c.drawString(xs[0], y, date)
        c.drawString(xs[1], y, desc)
        c.drawRightString(xs[3 if credit else 2] + 60, y, amount)
        c.drawRightString(xs[4] + 60, y, balance)
        t.row([date, desc, "" if credit else amount, amount if credit else "", balance])
    y -= 40
    c.setFont("Helvetica-Bold", 11)
    c.drawString(50, y, "Account summary")
    t = truth.table("Account summary", header_rows=0)
    c.setFont("Helvetica", 9.5)
    for label, v in [("Opening balance", opening), ("Total credits", credits), ("Total debits", debits), ("Closing balance", bal)]:
        y -= 15
        c.drawString(50, y, label)
        c.drawRightString(300, y, f"{v:,.2f}")
        t.row([label, f"{v:,.2f}"])
    c.save()
    truth.write(name)


def credit_card():
    """Credit card statement: owed balance, summary with minimum payment and credit limit, merchant descriptors."""
    name = "credit-card.pdf"
    truth = Truth().page("statement")
    c = canvas.Canvas(str(out / name), pagesize=letter, invariant=1)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(50, 740, "Northwind Rewards Visa Signature")
    c.setFont("Helvetica", 9.5)
    c.drawString(50, 724, "Statement period 03/01/2026 to 03/31/2026")
    # Purchases are printed positive and raise what's owed; the payment is negative.
    txns = [
        ("03/02/2026", "SQ *BLUE BOTTLE COFFEE OAKLAND CA", 6.50),
        ("03/03/2026", "AMZN Mktp US*2K4L9X8Z1", 98.45),
        ("03/04/2026", "PAYMENT - THANK YOU", -500.00),
        ("03/06/2026", "SHELL OIL 57444 HOUSTON TX", 41.20),
        ("03/09/2026", "TST* SWEETGREEN 0123 NEW YORK NY", 14.85),
        ("03/12/2026", "NETFLIX.COM 866-579-7172 CA", 15.49),
        ("03/15/2026", "UBER *TRIP HELP.UBER.COM CA", 23.10),
        ("03/18/2026", "WHOLE FOODS MKT #10234 AUSTIN TX", 82.40),
        ("03/21/2026", "AMAZON REFUND", -19.99),
        ("03/24/2026", "DELTA AIR 0062345678901 ATLANTA GA", 412.30),
        ("03/27/2026", "GITHUB INC. SAN FRANCISCO CA", 21.00),
        ("03/31/2026", "INTEREST CHARGE ON PURCHASES", 12.40),
    ]
    opening = 1200.00
    payments = round(-sum(a for _, _, a in txns if a < 0), 2)
    purchases = round(sum(a for _, d, a in txns if a > 0 and "INTEREST" not in d), 2)
    interest = 12.40
    closing = round(opening - payments + purchases + interest, 2)

    y = 694
    c.setFont("Helvetica-Bold", 11)
    c.drawString(50, y, "Account summary")
    t = truth.table("Account summary", header_rows=0)
    c.setFont("Helvetica", 9.5)
    for label, v in [
        ("Previous balance", f"{opening:,.2f}"),
        ("Payments and credits", f"-{payments:,.2f}"),
        ("Purchases", f"+{purchases:,.2f}"),
        ("Fees charged", "0.00"),
        ("Interest charged", f"+{interest:,.2f}"),
        ("New balance", f"{closing:,.2f}"),
        ("Minimum payment due", "35.00"),
        ("Credit limit", "8,000.00"),
        ("Available credit", f"{8000 - closing:,.2f}"),
    ]:
        y -= 15
        c.drawString(50, y, label)
        c.drawRightString(300, y, v)
        t.row([label, v])

    y -= 40
    c.setFont("Helvetica-Bold", 11)
    c.drawString(50, y, "Transactions")
    t = truth.table("Transactions")
    y -= 20
    xs = [50, 130, 500]
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(xs[0], y, "Date")
    c.drawString(xs[1], y, "Description")
    c.drawRightString(xs[2] + 60, y, "Amount")
    t.row(["Date", "Description", "Amount"])
    c.setFont("Helvetica", 9.5)
    for date, desc, amt in txns:
        y -= 15
        shown = f"{amt:,.2f}"
        c.drawString(xs[0], y, date)
        c.drawString(xs[1], y, desc)
        c.drawRightString(xs[2] + 60, y, shown)
        t.row([date, desc, shown])
    c.save()
    truth.write(name)


def batch_statements():
    """fixtures/batch/: five statements in one layout (one with a misread credit) and one invoice."""
    (out / "batch").mkdir(parents=True, exist_ok=True)
    months = [(1, 31, 1820.40), (2, 28, 2310.75), (3, 31, 1975.10), (4, 30, 2604.33), (5, 31, 2188.90)]
    for k, (month, last_day, opening) in enumerate(months):
        _statement_dc(f"batch/statement-{k + 1:02d}.pdf", seed=100 + k, month=month, last_day=last_day, opening=opening, plant=k == 3)
    _invoice("batch/invoice-01.pdf", "INVOICE #6001", INVOICE_LINES)


def _invoice(name: str, title: str, lines, wrong_line=None, total_delta=0.0):
    truth = Truth().page("invoice")
    t = truth.table()
    c = canvas.Canvas(str(out / name), pagesize=letter, invariant=1)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, 735, title)
    c.setFont("Helvetica", 10)
    c.drawString(50, 717, "Bill to: Contoso Facilities, 400 Pine St")
    xs = [50, 330, 420, 520]
    y = 680
    c.setFont("Helvetica-Bold", 10)
    c.drawString(xs[0], y, "Description")
    for x, h in zip(xs[1:], ["Qty", "Unit price", "Amount"]):
        c.drawRightString(x + 30, y, h)
    t.row(["Description", "Qty", "Unit price", "Amount"])
    c.setFont("Helvetica", 10)
    sub = 0.0
    for n, (desc, q, u) in enumerate(lines):
        y -= 16
        amt = round(q * u, 2)
        if n == wrong_line:
            amt = round(amt + 90, 2)  # a misread digit in the line total
        sub = round(sub + amt, 2)
        cells = [desc, str(q), f"{u:,.2f}", f"{amt:,.2f}"]
        c.drawString(xs[0], y, cells[0])
        c.drawRightString(xs[1] + 30, y, cells[1])
        c.drawRightString(xs[2] + 30, y, cells[2])
        c.drawRightString(xs[3] + 30, y, cells[3])
        t.row(cells)
    tax = round(sub * 0.0825, 2)
    y -= 10
    for label, v in [("Subtotal", sub), ("Sales tax 8.25%", tax), ("Total", round(sub + tax + total_delta, 2))]:
        y -= 16
        c.setFont("Helvetica-Bold" if label == "Total" else "Helvetica", 10)
        # The label starts in the Unit price column; the amount sits under Amount.
        c.drawString(xs[2] - 40, y, label)
        c.drawRightString(xs[3] + 30, y, f"{v:,.2f}")
        t.row(["", "", label, f"{v:,.2f}"])
    c.save()
    truth.write(name)


INVOICE_LINES = [("Copier paper, case", 12, 41.50), ("Toner cartridge", 4, 89.99), ("Desk lamp", 3, 27.25), ("Cable ties, pack", 25, 3.40), ("Whiteboard 4x6", 2, 159.00), ("Delivery", 1, 45.00)]


def invoice_lines():
    """Qty x unit = amount on every line but one (printed subtotal adds the printed amounts)."""
    _invoice("invoice-lines.pdf", "INVOICE #5523", INVOICE_LINES, wrong_line=2)


def invoice_tie():
    """Lines and subtotal are right; the printed total is not subtotal + tax."""
    _invoice("invoice-tie.pdf", "INVOICE #5524", INVOICE_LINES, total_delta=100.0)


def report_fy():
    """Quarterly report whose FY column cross-foots Q1..Q4 on every row but one."""
    truth = Truth().page("report")
    t = truth.table("Net sales by region (USD)")
    rng = random.Random(31)
    c = canvas.Canvas(str(out / "report-fy.pdf"), pagesize=letter, invariant=1)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, 740, "Net sales by region (USD)")
    xs = [50, 170, 240, 310, 380, 460, 530]
    heads = ["Region", "Q1", "Q2", "Q3", "Q4", "FY", "Growth"]
    y = 710
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(xs[0], y, heads[0])
    for x, h in zip(xs[1:], heads[1:]):
        c.drawRightString(x + 40, y, h)
    t.row(heads)
    c.setFont("Helvetica", 9.5)
    for n, region in enumerate(["Northeast", "Southeast", "Midwest", "Southwest", "Mountain", "Pacific", "Canada", "Mexico"]):
        y -= 15
        q = [rng.randint(40, 990) * 100 for _ in range(4)]
        fy = sum(q) + (900 if n == 4 else 0)  # one misread FY digit
        c.drawString(xs[0], y, region)
        cells = [region]
        for x, v in zip(xs[1:], [*q, fy]):
            c.drawRightString(x + 40, y, f"{v:,}")
            cells.append(f"{v:,}")
        growth = f"{rng.uniform(-5, 18):.1f}%"
        c.drawRightString(xs[6] + 40, y, growth)
        t.row([*cells, growth])
    c.save()
    truth.write("report-fy.pdf")


# ---------------------------------------------------------------- table structure stress
# These exist to measure table *structure* (eval/), not to pass corpus tests.
def multi_level_header():
    """Three header levels with spanning group cells, and a region label spanning its rows."""
    truth = Truth().page("report")
    t = truth.table("Revenue by region and product", header_rows=3)
    c = canvas.Canvas(str(out / "multi-level-header.pdf"), pagesize=letter, invariant=1)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(50, 740, "Revenue by region and product")
    num = [300, 360, 430, 490, 560]  # right edges of H1, H2, H1, H2, %
    y = 708
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString((num[0] - 30 + num[3]) / 2, y, "Revenue (USD thousands)")
    c.setLineWidth(0.5)
    c.line(num[0] - 45, y - 4, num[3], y - 4)
    t.row(["", "", "Revenue (USD thousands)", "", "", "", ""])
    t.span(0, 2, 1, 4)
    y -= 15
    c.drawCentredString((num[0] - 30 + num[1]) / 2, y, "Fiscal 2025")
    c.drawCentredString((num[2] - 30 + num[3]) / 2, y, "Fiscal 2026")
    c.drawRightString(num[4], y, "Change")
    c.line(num[0] - 45, y - 4, num[1], y - 4)
    c.line(num[2] - 45, y - 4, num[3], y - 4)
    t.row(["", "", "Fiscal 2025", "", "Fiscal 2026", "", "Change"])
    t.span(1, 2, 1, 2)
    t.span(1, 4, 1, 2)
    y -= 15
    leaf = ["Region", "Product", "H1", "H2", "H1", "H2", "%"]
    c.drawString(50, y, leaf[0])
    c.drawString(130, y, leaf[1])
    for x, h in zip(num, leaf[2:]):
        c.drawRightString(x, y, h)
    t.row(leaf)
    c.line(50, y - 4, num[4], y - 4)
    rng = random.Random(51)
    regions = [("North", ["Widgets", "Gadgets", "Services"]), ("South", ["Widgets", "Gadgets"]), ("West", ["Widgets", "Gadgets", "Services"])]
    totals = [0, 0, 0, 0]
    c.setFont("Helvetica", 9)
    for region, products in regions:
        first = len(t.rows)
        for k, product in enumerate(products):
            y -= 14
            v = [rng.randint(120, 2400) for _ in range(4)]
            totals = [a + b for a, b in zip(totals, v)]
            change = (v[2] + v[3] - v[0] - v[1]) / (v[0] + v[1]) * 100
            cells = [region if k == 0 else "", product, *[f"{x:,}" for x in v], f"{change:.1f}"]
            if k == 0:
                c.drawString(50, y, region)
            c.drawString(130, y, product)
            for x, s in zip(num, cells[2:]):
                c.drawRightString(x, y, s)
            t.row(cells)
        t.span(first, 0, len(products), 1)
        y -= 4
    y -= 14
    c.setFont("Helvetica-Bold", 9)
    change = (totals[2] + totals[3] - totals[0] - totals[1]) / (totals[0] + totals[1]) * 100
    cells = ["Total", "", *[f"{x:,}" for x in totals], f"{change:.1f}"]
    c.drawString(50, y, "Total")
    for x, s in zip(num, cells[2:]):
        c.drawRightString(x, y, s)
    t.row(cells)
    c.save()
    truth.write("multi-level-header.pdf")


def side_by_side_ruled():
    """Two ruled tables side by side with different row pitches, and a full-width table below."""
    truth = Truth().page("report")
    c = canvas.Canvas(str(out / "side-by-side-ruled.pdf"), pagesize=letter, invariant=1)
    c.setLineWidth(0.5)

    def ruled(t, x_edges, top, pitch, rows, right_cols, size=9):
        """Grid-lined table: rows[0] is the header. Records every cell drawn."""
        bottom = top - pitch * len(rows)
        for x in x_edges:
            c.line(x, top, x, bottom)
        for i in range(len(rows) + 1):
            c.line(x_edges[0], top - i * pitch, x_edges[-1], top - i * pitch)
        for i, r in enumerate(rows):
            c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", size)
            base = top - i * pitch - pitch + (pitch - size) / 2 + 1.5
            for k, s in enumerate(r):
                if k in right_cols:
                    c.drawRightString(x_edges[k + 1] - 4, base, s)
                else:
                    c.drawString(x_edges[k] + 4, base, s)
            t.row(r)

    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, 740, "Open invoices")
    c.drawString(322, 740, "Payments received")
    left = [["Invoice", "Customer", "Due", "Amount"], ["INV-2201", "Contoso", "07/02", "4,180.00"], ["INV-2207", "Fabrikam", "07/09", "912.50"],
            ["INV-2212", "Tailspin", "07/15", "12,040.00"], ["INV-2215", "Wingtip", "07/21", "388.75"], ["INV-2219", "Litware", "07/28", "2,604.10"], ["INV-2224", "Proseware", "08/03", "1,150.00"]]
    right = [["Date", "Payer", "Amount"], ["06/24", "Northwind", "3,500.00"], ["06/27", "Adventure Works", "1,275.40"], ["06/30", "Contoso", "6,000.00"]]
    ruled(truth.table("Open invoices"), [40, 100, 170, 215, 290], 728, 16, left, {3})
    ruled(truth.table("Payments received"), [322, 366, 470, 572], 728, 22, right, {2})
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, 560, "Aging summary")
    t = truth.table("Aging summary")
    aging = [["Bucket", "Current", "1-30", "31-60", "61-90", "90+"], ["Receivables", "8,412.10", "6,240.00", "1,150.00", "388.75", "0.00"], ["Payables", "5,903.33", "2,118.00", "0.00", "640.00", "75.00"]]
    xs = [40, 220, 300, 380, 460, 540]
    y = 540
    for i, r in enumerate(aging):
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 9)
        c.drawString(xs[0], y, r[0])
        for x, s in zip(xs[1:], r[1:]):
            c.drawRightString(x + 30, y, s)
        t.row(r)
        y -= 14
    c.save()
    truth.write("side-by-side-ruled.pdf")


def borderless_wrapped():
    """Borderless 7pt ledger with narrow gutters and two columns that wrap independently."""
    truth = Truth().page("report")
    t = truth.table("Expense detail - Q2 2026")
    rng = random.Random(41)
    c = canvas.Canvas(str(out / "borderless-wrapped.pdf"), pagesize=letter, invariant=1)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(36, 748, "Expense detail - Q2 2026")
    xs = {"ref": 36, "date": 76, "desc": 124, "cat": 286, "notes": 362, "amt": 576}
    widths = {"desc": 150, "notes": 150}
    size, lead = 7, 8.4
    y = 724
    c.setFont("Helvetica-Bold", size)
    heads = ["Ref", "Date", "Description", "Category", "Notes", "Amount"]
    for k, h in zip(["ref", "date", "desc", "cat", "notes"], heads):
        c.drawString(xs[k], y, h)
    c.drawRightString(xs["amt"], y, heads[5])
    t.row(heads)
    vendors = ["Delta Air Lines", "Marriott Downtown", "Staples", "AWS", "Zoom Video", "Uber", "FedEx", "Office Depot", "Hilton Garden Inn", "WeWork"]
    purposes = ["client kickoff workshop in Denver with the analytics team", "monthly hosting for the reporting platform", "replacement toner and paper for the third floor",
                "team offsite, two nights, shared rooms", "annual licence renewal", "airport transfer", "overnight courier of signed contracts to counsel",
                "ergonomic chairs for new hires", "quarterly board meeting catering"]
    cats = ["Travel", "Lodging", "Supplies", "Software", "Shipping", "Meals", "Equipment"]
    notes = ["", "Receipt attached", "Approved by finance; split across two cost centres per policy 4.2", "Reimbursable by client under SOW 17",
             "Missing itemised receipt, card statement used instead", "Pre-approved", "Includes 8% tip"]
    c.setFont("Helvetica", size)
    y -= lead + 3
    for n in range(24):
        desc = f"{rng.choice(vendors)} - {rng.choice(purposes)}"
        note = rng.choice(notes)
        cells = [f"EX-{3100 + n * 7}", f"{4 + n // 9:02d}/{(n * 5) % 28 + 1:02d}/26", desc, rng.choice(cats), note, f"{rng.uniform(12, 4200):,.2f}"]
        dl, nl = _wrap(desc, widths["desc"], "Helvetica", size), _wrap(note, widths["notes"], "Helvetica", size) if note else []
        c.drawString(xs["ref"], y, cells[0])
        c.drawString(xs["date"], y, cells[1])
        c.drawString(xs["cat"], y, cells[3])
        c.drawRightString(xs["amt"], y, cells[5])
        for i, ln in enumerate(dl):
            c.drawString(xs["desc"], y - i * lead, ln)
        for i, ln in enumerate(nl):
            c.drawString(xs["notes"], y - i * lead, ln)
        t.row([cells[0], cells[1], " ".join(dl), cells[3], " ".join(nl), cells[5]])
        y -= lead * max(len(dl), len(nl), 1) + 3.5
    c.save()
    truth.write("borderless-wrapped.pdf")


# ---------------------------------------------------------------- non-table noise
# Real documents carry far more non-table content than tables. Only the real
# data tables are in the truth; everything else is there to catch extractors
# that turn page furniture, charts and two-column prose into "tables".
SENTENCES = [
    "The board reviewed the results for the period and considers the group well placed for the year ahead.",
    "Recurring revenue now accounts for the large majority of the total, which improves visibility of future earnings.",
    "We continued to invest in product development while holding administrative costs broadly flat in real terms.",
    "Customer retention remained high across all regions, with particular strength in the mid-market segment.",
    "Cash generation was strong, allowing us to reduce net debt and to propose an increased final dividend.",
    "Our people remain the foundation of the business, and engagement scores improved for the third consecutive year.",
    "Supply chain conditions normalised during the second half, easing pressure on hardware margins.",
    "We expect market conditions to remain competitive and have planned accordingly, with a focus on efficiency.",
    "The integration of the acquired business is complete and the expected cost synergies have been delivered.",
    "Risk management processes were reviewed during the year and no significant weaknesses were identified.",
]
LEGAL = [
    "In case of errors or questions about your electronic transfers, telephone us or write to us at the address shown on this statement as soon as you can.",
    "We must hear from you no later than 60 days after we sent the first statement on which the problem or error appeared.",
    "Tell us your name and account number, describe the error or the transfer you are unsure about, and explain as clearly as you can why you believe it is an error.",
    "We will investigate your complaint and will correct any error promptly. If we take more than 10 business days, we will credit your account for the amount you think is in error.",
    "Overdraft fees are assessed per item and are limited to three per business day. Items are posted in the order they are received.",
    "The annual percentage yield is accurate as of the statement closing date and may change after the account is opened.",
    "Deposits are federally insured up to the standard maximum per depositor for each account ownership category.",
    "Balances shown include all transactions posted through the closing date; pending card authorizations are not included.",
]


def prose(c, x, y, width, sentences, font="Times-Roman", size=10, lead=None, bottom=60):
    """Draw sentences as one wrapped paragraph; returns the y below it."""
    lead = lead or size * 1.3
    c.setFont(font, size)
    for ln in _wrap(" ".join(sentences), width, font, size):
        if y < bottom:
            break
        c.drawString(x, y, ln)
        y -= lead
    return y


def noisy_statement():
    """4-page statement: letterhead and footers on every page, summary, chart, marketing, messages, disclosures."""
    truth = Truth()
    rng = random.Random(61)
    c = canvas.Canvas(str(out / "noisy-statement.pdf"), pagesize=letter, invariant=1)
    pages = 4

    def furniture(n):
        c.setFont("Helvetica-Bold", 11)
        c.drawString(40, 760, "Riverbank Federal Credit Union")
        c.setFont("Helvetica", 8)
        c.drawString(40, 748, "1200 Harbor Way, Portsmouth, NH 03801")
        c.drawRightString(572, 760, "Member statement")
        c.drawRightString(572, 748, "June 1 - June 30, 2026")
        c.setLineWidth(0.5)
        c.line(40, 740, 572, 740)
        c.line(40, 50, 572, 50)
        c.setFont("Helvetica", 7)
        c.drawString(40, 38, "Riverbank Federal Credit Union - Federally insured by NCUA")
        c.drawRightString(572, 38, f"Page {n} of {pages}")

    # Transactions first, so page 1's summary can total them.
    txns, bal = [], 3214.55
    opening = bal
    descs = ["POS purchase Hannaford #412", "ACH deposit PAYROLL ACME", "Check 1043", "Online transfer to savings", "ATM withdrawal", "POS purchase Shell 2231",
             "Bill pay Eversource", "Mobile deposit", "POS purchase Amazon Mktp", "ACH debit Netflix"]
    for i in range(46):
        d = rng.choice(descs)
        credit = d.startswith(("ACH deposit", "Mobile"))
        amt = round(rng.uniform(300, 2200) if credit else rng.uniform(4, 380), 2)
        bal = round(bal + (amt if credit else -amt), 2)
        txns.append([f"06/{1 + i * 29 // 46:02d}/2026", d, "" if credit else f"{amt:,.2f}", f"{amt:,.2f}" if credit else "", f"{bal:,.2f}"])
    deposits = sum(float(t[3].replace(",", "")) for t in txns if t[3])
    withdrawals = sum(float(t[2].replace(",", "")) for t in txns if t[2])

    # Page 1: member block, account summary, a bar chart, a marketing insert.
    truth.page("statement")
    furniture(1)
    c.setFont("Helvetica", 9)
    for i, (a, b) in enumerate([("Jordan A. Example", "Account number: 000-4417-22"), ("48 Elm Street", "Statement date: June 30, 2026"), ("Dover, NH 03820", "Questions: 1-800-555-0100")]):
        c.drawString(40, 715 - i * 12, a)
        c.drawString(360, 715 - i * 12, b)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(40, 660, "Account summary")
    t = truth.table("Account summary", header_rows=0)
    c.setFont("Helvetica", 9.5)
    y = 642
    for label, v in [("Beginning balance", opening), ("Deposits and credits", deposits), ("Withdrawals and debits", -withdrawals), ("Ending balance", bal)]:
        s = money(v)
        c.drawString(40, y, label)
        c.drawRightString(300, y, s)
        t.row([label, s])
        y -= 14
    # Bar chart: tick labels, bar values and category names are all real text.
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, 560, "Where your money went")
    base, top, x0 = 420, 540, 80
    c.setFont("Helvetica", 7)
    for k, tick in enumerate(["0", "250", "500", "750", "1,000"]):
        ty = base + k * (top - base) / 4
        c.drawRightString(x0 - 6, ty - 2, tick)
        c.setLineWidth(0.2)
        c.line(x0, ty, 520, ty)
    cats = [("Dining", 412), ("Groceries", 655), ("Travel", 230), ("Utilities", 318), ("Shopping", 874), ("Other", 96)]
    for k, (name, v) in enumerate(cats):
        bx = x0 + 20 + k * 72
        h = v / 1000 * (top - base)
        c.setFillGray(0.55)
        c.rect(bx, base, 36, h, stroke=0, fill=1)
        c.setFillGray(0)
        c.drawCentredString(bx + 18, base + h + 3, f"{v:,}")
        c.drawCentredString(bx + 18, base - 10, name)
    # Marketing insert: a shaded box with a three-up feature row.
    c.setFillGray(0.92)
    c.rect(40, 250, 532, 130, stroke=0, fill=1)
    c.setFillGray(0)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 350, "Earn more with Premier Checking")
    for k, (head, sub) in enumerate([("2.10% APY", "on balances over $2,500"), ("No monthly fee", "with direct deposit"), ("Free ATMs", "at 55,000 locations")]):
        c.setFont("Helvetica-Bold", 10)
        c.drawString(60 + k * 175, 318, head)
        c.setFont("Helvetica", 8)
        c.drawString(60 + k * 175, 306, sub)
    c.setFont("Helvetica", 8)
    c.drawString(60, 270, "Visit riverbank.example/premier or call 1-800-555-0142. Offer ends August 31, 2026.")
    c.showPage()

    # Pages 2-3: transaction detail; page 3 ends with a "Messages for you" box.
    heads = ["Date", "Description", "Withdrawals", "Deposits", "Balance"]
    xs = [40, 105, 390, 470, 560]

    def txn_table(title, rows, y):
        c.setFont("Helvetica-Bold", 11)
        c.drawString(40, y, title)
        t = truth.table(title)
        y -= 22
        c.setFont("Helvetica-Bold", 9)
        c.drawString(xs[0], y, heads[0])
        c.drawString(xs[1], y, heads[1])
        for x, h in zip(xs[2:], heads[2:]):
            c.drawRightString(x, y, h)
        t.row(heads)
        c.setFont("Helvetica", 9)
        for r in rows:
            y -= 13.5
            c.drawString(xs[0], y, r[0])
            c.drawString(xs[1], y, r[1])
            for x, s in zip(xs[2:], r[2:]):
                if s:
                    c.drawRightString(x, y, s)
            t.row(r)
        return y

    truth.page("statement")
    furniture(2)
    txn_table("Transaction detail", txns[:34], 715)
    c.showPage()
    truth.page("statement")
    furniture(3)
    y = txn_table("Transaction detail (continued)", txns[34:], 715) - 40
    c.setLineWidth(0.8)
    c.rect(40, y - 150, 532, 150, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(54, y - 20, "Messages for you")
    yy = prose(c, 54, y - 38, 500, ["Starting August 1, mobile deposits made before 8 p.m. Eastern will be available the next business day.",
                                     "Remember that we will never ask for your password or one-time code by phone, text or email."], "Helvetica", 8.5)
    yy = prose(c, 54, yy - 6, 500, ["Our branches will be closed on Friday, July 3, in observance of Independence Day."], "Helvetica", 8.5)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(54, y - 135, "Questions about this statement?")
    c.drawRightString(558, y - 135, "1-800-555-0100")
    c.showPage()

    # Page 4: two-column legal disclosures in small type. Prose, not a table.
    truth.page("text")
    furniture(4)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(40, 720, "Important disclosures")
    for col, x in enumerate([40, 318]):
        y = 700
        for k in range(13):
            y = prose(c, x, y, 254, [LEGAL[(k + col * 3) % len(LEGAL)], LEGAL[(k + col * 3 + 1) % len(LEGAL)]], "Helvetica", 6.5, 8, bottom=70) - 5
    c.save()
    truth.write("noisy-statement.pdf")


def annual_report_excerpt():
    """7 pages: contents with dot leaders, prose in one and two columns, pull-quotes, footnotes, two real tables."""
    truth = Truth()
    rng = random.Random(71)
    c = canvas.Canvas(str(out / "annual-report-excerpt.pdf"), pagesize=letter, invariant=1)

    def furniture(n):
        c.setFont("Helvetica", 8)
        c.drawString(54, 760, "Lumen Holdings plc")
        c.drawRightString(558, 760, "Annual Report 2026")
        c.drawCentredString(306, 36, str(n))

    def para(n=3):
        return [rng.choice(SENTENCES) for _ in range(n)]

    def two_columns(y, bottom, size=9):
        for x in (54, 318):
            yy = y
            while yy > bottom + 40:
                yy = prose(c, x, yy, 240, para(3), "Times-Roman", size, bottom=bottom) - 6

    def pull_quote(y, text):
        c.setLineWidth(1)
        c.line(120, y + 18, 492, y + 18)
        c.setFont("Times-Italic", 15)
        for i, ln in enumerate(_wrap(text, 360, "Times-Italic", 15)):
            c.drawCentredString(306, y - i * 19, ln)
        n = len(_wrap(text, 360, "Times-Italic", 15))
        c.line(120, y - n * 19 + 6, 492, y - n * 19 + 6)
        return y - n * 19 - 14

    # Page 1: contents, with dot leaders and right-aligned page numbers.
    truth.page("text")
    furniture(1)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(72, 690, "Contents")
    y = 650
    toc = [("Strategic report", None), ("Chair's letter", 2), ("Business review", 3), ("Financial statements", None), ("Consolidated income statement", 4),
           ("Outlook", 5), ("Segment information", 6), ("Other information", None), ("Forward-looking statements", 7), ("Shareholder information", 7)]
    for title, pg in toc:
        if pg is None:
            y -= 8
            c.setFont("Helvetica-Bold", 11)
            c.drawString(72, y, title)
        else:
            c.setFont("Helvetica", 10.5)
            c.drawString(90, y, title)
            start = 90 + pdfmetrics.stringWidth(title, "Helvetica", 10.5) + 6
            dots = int((520 - start) / pdfmetrics.stringWidth(". ", "Helvetica", 10.5))
            c.drawString(start, y, ". " * dots)
            c.drawRightString(540, y, str(pg))
        y -= 22
    c.showPage()

    # Page 2: chair's letter, one column, with a pull-quote.
    truth.page("text")
    furniture(2)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, 700, "Chair's letter")
    y = prose(c, 72, 672, 468, para(6), "Times-Roman", 10.5) - 10
    y = pull_quote(y - 20, "“We grew where it mattered: recurring revenue rose 21% and every region contributed.”") - 10
    y = prose(c, 72, y, 468, para(5), "Times-Roman", 10.5) - 10
    prose(c, 72, y, 468, para(4), "Times-Roman", 10.5)
    c.showPage()

    # Page 3: business review, two columns, footnote markers and footnotes.
    truth.page("text")
    furniture(3)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(54, 700, "Business review")
    for x in (54, 318):
        yy = 676
        for k in range(5):
            s = para(2)
            s[-1] = s[-1][:-1] + ("¹." if (x, k) == (54, 1) else "²." if (x, k) == (318, 2) else ".")
            yy = prose(c, x, yy, 240, s, "Times-Roman", 9.5, bottom=140) - 6
    c.setLineWidth(0.5)
    c.line(54, 120, 200, 120)
    c.setFont("Times-Roman", 7)
    c.drawString(54, 108, "¹ Growth rates are stated at constant currency unless otherwise noted.")
    c.drawString(54, 98, "² Includes the acquired Lumen Hardware business from 1 March 2026.")
    c.showPage()

    # Page 4: the income statement (a real table), with notes below it.
    truth.page("report")
    furniture(4)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(54, 700, "Consolidated income statement")
    c.setFont("Helvetica", 8.5)
    c.drawString(54, 686, "For the year ended 31 December 2026")
    t = truth.table(header_rows=2)
    xs_note, xs_a, xs_b = 360, 460, 540
    y = 656
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString((xs_a - 40 + xs_b) / 2, y, "Year ended 31 December")
    c.line(xs_a - 55, y - 4, xs_b, y - 4)
    t.row(["", "", "Year ended 31 December", ""])
    t.span(0, 2, 1, 2)
    y -= 14
    c.drawRightString(xs_note, y, "Note")
    c.drawRightString(xs_a, y, "2026 £m")
    c.drawRightString(xs_b, y, "2025 £m")
    t.row(["", "Note", "2026 £m", "2025 £m"])
    lines = [("Revenue", "3", "1,842.6", "1,523.1", False), ("Cost of sales", "", "(1,011.4)", "(861.9)", False), ("Gross profit", "", "831.2", "661.2", True),
             ("Distribution costs", "", "(142.0)", "(120.7)", False), ("Administrative expenses", "", "(318.5)", "(289.9)", False), ("Exceptional items³", "5", "(22.1)", "—", False),
             ("Operating profit", "", "348.6", "250.6", True), ("Finance income", "", "6.2", "3.1", False), ("Finance costs", "", "(31.8)", "(36.4)", False),
             ("Profit before tax", "", "323.0", "217.3", True), ("Taxation", "6", "(80.8)", "(52.1)", False), ("Profit for the year", "", "242.2", "165.2", True)]
    for label, note, a, b, bold in lines:
        y -= 14
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 9)
        c.drawString(54, y, label)
        if note:
            c.drawRightString(xs_note, y, note)
        c.drawRightString(xs_a, y, a)
        c.drawRightString(xs_b, y, b)
        t.row([label, note, a, b])
    y -= 22
    c.setFont("Helvetica-Bold", 9)
    c.drawString(54, y, "Earnings per share")
    t.row(["Earnings per share"])
    for label, note, a, b in [("Basic (pence)", "7", "41.2", "33.5"), ("Diluted (pence)", "7", "40.6", "33.0")]:
        y -= 14
        c.setFont("Helvetica", 9)
        c.drawString(54, y, label)
        c.drawRightString(xs_note, y, note)
        c.drawRightString(xs_a, y, a)
        c.drawRightString(xs_b, y, b)
        t.row([label, note, a, b])
    c.setFont("Times-Roman", 7)
    c.drawString(54, y - 30, "³ Exceptional items comprise acquisition costs and the restructuring of the European distribution network.")
    prose(c, 54, y - 56, 504, para(4), "Times-Roman", 9.5)
    c.showPage()

    # Page 5: outlook, two columns around a full-width pull-quote.
    truth.page("text")
    furniture(5)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(54, 700, "Outlook")
    two_columns(676, 470)
    y = pull_quote(430, "“Our priority for 2027 is disciplined growth: more customers, deeper relationships, steady margins.”")
    two_columns(y - 20, 70)
    c.showPage()

    # Page 6: segment table with a two-level header, between paragraphs.
    truth.page("report")
    furniture(6)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(54, 700, "Segment information")
    y = prose(c, 54, 676, 504, para(4), "Times-Roman", 9.5) - 24
    t = truth.table(header_rows=2)
    cols = [250, 310, 380, 440, 540]
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString((cols[0] - 30 + cols[1]) / 2, y, "Revenue")
    c.drawCentredString((cols[2] - 30 + cols[3]) / 2, y, "Operating profit")
    c.line(cols[0] - 45, y - 4, cols[1], y - 4)
    c.line(cols[2] - 45, y - 4, cols[3], y - 4)
    t.row(["", "Revenue", "", "Operating profit", "", ""])
    t.span(0, 1, 1, 2)
    t.span(0, 3, 1, 2)
    y -= 14
    leaf = ["Segment", "2026", "2025", "2026", "2025", "Margin 2026"]
    c.drawString(54, y, leaf[0])
    for x, h in zip(cols, leaf[1:]):
        c.drawRightString(x, y, h)
    t.row(leaf)
    segs = [("Software", 1120.4, 902.7, 261.8, 188.0), ("Services", 402.9, 371.5, 52.3, 44.1), ("Hardware", 214.0, 168.2, 21.9, 12.6), ("Payments", 105.3, 80.7, 12.6, 5.9)]
    for name, *v in segs + [("Total", *[sum(s[i] for s in segs) for i in range(1, 5)])]:
        y -= 14
        c.setFont("Helvetica-Bold" if name == "Total" else "Helvetica", 9)
        cells = [name, *[f"{x:,.1f}" for x in v], f"{v[2] / v[0] * 100:.1f}%"]
        c.drawString(54, y, name)
        for x, s in zip(cols, cells[1:]):
            c.drawRightString(x, y, s)
        t.row(cells)
    prose(c, 54, y - 36, 504, para(5), "Times-Roman", 9.5)
    c.showPage()

    # Page 7: small-print forward-looking statements and shareholder information.
    truth.page("text")
    furniture(7)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(54, 700, "Forward-looking statements")
    y = prose(c, 54, 682, 504, para(7), "Times-Roman", 8) - 18
    c.setFont("Helvetica-Bold", 12)
    c.drawString(54, y, "Shareholder information")
    prose(c, 54, y - 18, 504, para(5), "Times-Roman", 8)
    c.save()
    truth.write("annual-report-excerpt.pdf")


if __name__ == "__main__":
    out.mkdir(parents=True, exist_ok=True)
    fixtures = {
        "statement": statement, "scans": scans, "images": images, "ruled_wrapped": ruled_wrapped, "eu_invoice": eu_invoice,
        "financial_report": financial_report, "mixed": mixed, "dense_wide": dense_wide, "side_by_side": side_by_side,
        "no_header": no_header, "protected": protected,
        "statement_dc": lambda: (statement_dc(False), statement_dc(True)), "invoice_lines": invoice_lines,
        "invoice_tie": invoice_tie, "report_fy": report_fy, "batch_statements": batch_statements,
        "multi_level_header": multi_level_header, "side_by_side_ruled": side_by_side_ruled, "borderless_wrapped": borderless_wrapped,
        "noisy_statement": noisy_statement, "annual_report_excerpt": annual_report_excerpt,
        "credit_card": credit_card,
    }
    # Optional names after the output dir regenerate only those fixtures.
    for name in sys.argv[2:] or fixtures:
        fixtures[name]()
        print("ok", name)
