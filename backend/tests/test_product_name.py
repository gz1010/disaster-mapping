"""The product is called "Disaster Mapping" (brief 6, decision 1).

No string the backend can send or show (messages, notes, caveats, credits, docstrings that become API descriptions,
the outgoing User-Agent) still uses the old name "Fire-3d" or its spellings. Internal names stay and are allowed: the
``fire3d`` package, ``FIRE3D_*`` settings and lowercase ids such as ``fire3d-flood-live-refresh``. Comments are not
scanned (they are not sent anywhere).
"""

from __future__ import annotations

import io
import re
import tokenize
from pathlib import Path

from fire3d import config

BACKEND = Path(__file__).resolve().parents[1]
OLD_NAME = re.compile(r"Fire[- ]?3[dD]|FIRE[- ]3D")                    # not FIRE3D_* (settings)
_TEXT_TOKENS = {tokenize.STRING} | {getattr(tokenize, n) for n in ("FSTRING_MIDDLE",) if hasattr(tokenize, n)}


def _texts(source: str) -> list[str]:
    """Every string literal and f-string text part of a Python source (comments skipped)."""
    return [t.string for t in tokenize.generate_tokens(io.StringIO(source).readline) if t.type in _TEXT_TOKENS]


def _old_name_uses(files: list[Path]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for p in files:
        hits = [s for s in _texts(p.read_text(encoding="utf-8")) if OLD_NAME.search(s)]
        if hits:
            out[p.relative_to(BACKEND).as_posix() if p.is_relative_to(BACKEND) else p.name] = hits
    return out


def test_no_backend_string_uses_the_old_name() -> None:
    files = sorted((BACKEND / "fire3d").rglob("*.py")) + sorted((BACKEND / "scripts").rglob("*.py"))
    assert len(files) > 50
    assert _old_name_uses(files) == {}


def test_user_agent_names_the_app() -> None:
    """Read from config.py's source: the recorder scripts that some tests import reassign ``config.USER_AGENT``."""
    src = (BACKEND / "fire3d" / "config.py").read_text(encoding="utf-8")
    assert 'USER_AGENT = "Disaster-Mapping/0.1 (research prototype)"' in src
    assert config.USER_AGENT.startswith("Disaster-Mapping/0.1")


def test_a_planted_old_name_is_found_in_strings_not_comments(tmp_path: Path) -> None:
    src = tmp_path / "planted.py"
    src.write_text(
        "# Fire-3d in a comment is not sent anywhere\n"
        "A = 'Fire-3d has not prepared this flood'\n"
        "B = f\"{x}: Fire 3D's request limit\"\n"
        '"""SEEN BY FIRE-3D SINCE"""\n'
        "C = 'fire3d-flood-live-refresh'  # internal id: allowed\n",
        encoding="utf-8",
    )
    hits = _old_name_uses([src])
    assert list(hits) and len(next(iter(hits.values()))) == 3
