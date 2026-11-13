"""Build the English membership attachment from the editable terms source."""
from pathlib import Path
from html.parser import HTMLParser
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.pagesizes import LETTER
from reportlab.platypus import Paragraph, SimpleDocTemplate

root = Path(__file__).resolve().parents[1]
styles = getSampleStyleSheet()
styles["BodyText"].fontName = "Times-Roman"
styles["BodyText"].fontSize = 12
styles["BodyText"].leading = 16
story = []

class TermsParser(HTMLParser):
    def handle_starttag(self, tag, attrs):
        if tag in ("h1", "h2", "p"):
            self.tag = tag
            self.parts = []

    def handle_data(self, data):
        if getattr(self, "tag", None):
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == getattr(self, "tag", None):
            style = {"h1": "Title", "h2": "Heading2", "p": "BodyText"}[tag]
            story.append(Paragraph("".join(self.parts), styles[style]))
            self.tag = None

def running_labels(canvas, document):
    canvas.setFont("Helvetica", 9)
    canvas.drawString(54, 750, "PLIEGO EDITIONS")
    canvas.drawRightString(558, 36, str(document.page))

TermsParser().feed((root / "public/terminos.html").read_text())
document = SimpleDocTemplate(str(root / "public/club-pliego-terms.pdf"), pagesize=LETTER,
                             leftMargin=54, rightMargin=54, title="Club Pliego Terms and Conditions",
                             author="Pliego Editions")
document.build(story, onFirstPage=running_labels, onLaterPages=running_labels)
