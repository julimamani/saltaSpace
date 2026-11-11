import os
import tempfile

os.environ.setdefault("ENABLE_SCHEDULER", "false")
os.environ.setdefault("DATABASE_PATH", os.path.join(tempfile.mkdtemp(), "test.db"))
