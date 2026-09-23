# syntax=docker/dockerfile:1.7
#
# Kev — small calibrated decision models behind TypeSafe's System One API.
# Upstream ships no image, so HQ builds one. CPU only: the weights are a LoRA
# adapter plus a pointer head on a Qwen3.5 base, and prompt processing is the
# whole job, so cores decide the speed and RAM only has to hold the model.
#
#   https://github.com/jaredpalmer/kev   Apache-2.0

# 3.13, not 3.14: Kev pins torch<2.9 and PyTorch publishes no cp314 wheels before
# 2.9.0. One arg to flip once upstream takes a newer torch.
ARG PYTHON_VERSION=3.13
FROM python:${PYTHON_VERSION}-slim

# curl serves the healthcheck and fetches the source. No git in the build.
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# A pinned static binary, the same one backend/Dockerfile uses.
COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    # Weights live on a volume, not in the image: ~9GB for the 4B base, and one
    # cache per host is shared by every checkout.
    HF_HOME=/models \
    # Kev declares no build backend, so upstream's `uv sync` installs its
    # dependencies and runs the source in place. We do the same: dependencies
    # into the system prefix, the tree on the path. Installing it as a package
    # instead makes setuptools guess at a repo whose root holds kev/, tests/,
    # scripts/ and evals/, and it refuses.
    PYTHONPATH=/opt/kev

# The upstream commit this image is built from. Alpha software that moves daily,
# so it is pinned rather than tracked — bump it deliberately.
ARG KEV_REF=aa03dfd510e216556db18baa2a54ea8224ccdd4d
RUN curl -fsSL "https://codeload.github.com/jaredpalmer/kev/tar.gz/${KEV_REF}" \
      | tar -xz -C /opt \
 && mv "/opt/kev-${KEV_REF}" /opt/kev

# Torch first, from the CPU index: PyPI's default wheel drags in the CUDA stack
# (~2.5GB) that nothing here can use. Kev's own install then finds the
# requirement already satisfied and leaves the CPU build in place.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system --index-url https://download.pytorch.org/whl/cpu "torch>=2.6,<2.9"
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install --system -r /opt/kev/pyproject.toml --extra serve

COPY entrypoint.py /opt/entrypoint.py

# Relative paths in kev (its `runs/` fallback) resolve against the source tree.
WORKDIR /opt/kev

EXPOSE 8009
CMD ["python", "/opt/entrypoint.py"]
