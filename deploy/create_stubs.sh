#!/bin/bash
# Create stub packages for modules not needed at inference time
set -e

SITE=/usr/local/lib/python3.10/dist-packages

# flash_attn stub
mkdir -p "$SITE/flash_attn"
cat > "$SITE/flash_attn/__init__.py" << 'EOF'
EOF

cat > "$SITE/flash_attn/flash_attn_interface.py" << 'EOF'
def flash_attn_varlen_qkvpacked_func(*a, **kw):
    raise NotImplementedError("flash_attn stub")
flash_attn_unpadded_qkvpacked_func = flash_attn_varlen_qkvpacked_func
EOF

cat > "$SITE/flash_attn/bert_padding.py" << 'EOF'
def pad_input(*a, **kw):
    raise NotImplementedError("flash_attn stub")
def unpad_input(*a, **kw):
    raise NotImplementedError("flash_attn stub")
EOF

# decord stub
mkdir -p "$SITE/decord"
cat > "$SITE/decord/__init__.py" << 'EOF'
class VideoReader:
    def __init__(self, *a, **kw):
        raise NotImplementedError("decord stub")
EOF
