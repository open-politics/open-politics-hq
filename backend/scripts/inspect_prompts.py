#!/usr/bin/env python3
"""Show what prompts get sent to LLMs"""
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.tests.prompt_inspector import print_all

if __name__ == "__main__":
    print_all()
