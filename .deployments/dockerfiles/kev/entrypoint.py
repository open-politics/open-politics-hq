"""Start kev.serve with the bind address and checkpoint taken from the environment.

``kev.serve.main()`` parses argv and then calls ``uvicorn.run(app,
host="127.0.0.1", port=...)`` with the address hardcoded (serve.py:189). That is
the right default for a laptop and wrong for a container in bridge mode, where
nothing outside the container can reach a loopback bind.

So: supply argv from the environment, and swap the bind for KEV_HOST. Everything
else — the checkpoint, dtype, prefix cache — kev already reads from env itself.

KEV_HOST defaults to 127.0.0.1, which is what host-network mode wants and what
the loopback audit checks. Compose sets 0.0.0.0 for bridge mode, where the
published port is already pinned to 127.0.0.1 on the host side.

Worth upstreaming as a --host flag; this file goes away when that lands.
"""

import os
import sys

import uvicorn

import kev.serve

_run = uvicorn.run


def _bind_from_env(app, **kwargs):
    # `or`, not a get() default: compose passes an empty string when HQ.yml has
    # no value for it, and an empty bind is not a bind.
    kwargs["host"] = os.environ.get("KEV_HOST") or "127.0.0.1"
    return _run(app, **kwargs)


def _threads() -> None:
    """Pin torch's thread count when the operator set one; otherwise leave it.

    Not OMP_NUM_THREADS: 0 is not a legal value for it and an empty one is read
    differently by each runtime, so the "let torch decide" case has to be the
    absence of a call, not a magic number in the environment.
    """
    raw = os.environ.get("KEV_THREADS", "").strip()
    if not raw or raw == "0":
        return
    import torch

    torch.set_num_threads(int(raw))


def main() -> None:
    _threads()
    checkpoint = os.environ.get("KEV_RUN", "").strip()
    if not checkpoint:
        raise SystemExit(
            "KEV_RUN is empty — name a checkpoint, e.g. jaredpalmer/kev-4b. "
            "In HQ it comes from foundation.providers.kev.run in HQ.yml."
        )
    sys.argv = ["kev.serve", "--run", checkpoint,
                "--port", os.environ.get("KEV_PORT") or "8009"]
    uvicorn.run = _bind_from_env
    kev.serve.main()


if __name__ == "__main__":
    main()
