# PlatformIO post-build: підписує firmware.bin приватним ключем -> firmware.bin.signed
# Ключ: ~/.deye/fw-signing/private.key (не в git). Публічний: src/fw_pubkey.h + signing-public.key.
import os, subprocess, sys
Import("env")

def sign(source, target, env):
    key = os.path.expanduser(os.environ.get("FW_SIGNING_KEY", "~/.deye/fw-signing/private.key"))
    bin_path = str(target[0])
    out = bin_path + ".signed"
    if not os.path.isfile(key):
        print("!! signing key not found, unsigned build:", key); return
    tool = os.path.join(env.PioPlatform().get_package_dir("framework-arduinoespressif8266"), "tools", "signing.py")
    subprocess.check_call([sys.executable, tool, "--mode", "sign", "--privatekey", key, "--bin", bin_path, "--out", out])
    print("signed firmware:", out, os.path.getsize(out), "bytes")

env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", sign)
