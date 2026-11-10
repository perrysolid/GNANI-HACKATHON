import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
os.environ["TWOFACTOR_API_KEY"] = ""
os.environ["LLM_BASE_URL"] = ""
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["ENV"] = "development"
