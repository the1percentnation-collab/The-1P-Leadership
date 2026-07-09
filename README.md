# The-1P-Leadership
Leadership/Coaching Cert

## OpenMontage (video production)

[OpenMontage](https://github.com/calesthio/OpenMontage) — an open-source, agentic video production system — is included as a git submodule at `OpenMontage/`.

### Setup

```bash
# After cloning this repo (or if OpenMontage/ is empty):
git submodule update --init

# Install dependencies (requires Python 3.10+, Node.js 18+, FFmpeg):
cd OpenMontage
make setup
```

Then open the project in an AI coding assistant and describe the video you want. API keys are optional — add them to `OpenMontage/.env` to unlock cloud providers (see `OpenMontage/README.md`).
