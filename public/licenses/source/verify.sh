#!/bin/bash
# Writes mac/VERIFY.txt; exit status = number of failed checks
R=$HOME/Documents/Showcaller/Releases/Tools/ffmpeg-lgpl
F=$R/mac/ffmpeg
T=$(mktemp -d)
FAIL=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; FAIL=$((FAIL+1)); }
have() { # have <listing> <name...>
  local L=$1; shift
  for n in "$@"; do grep -qwE "^ *[A-Z.]* *$n( |$)|^ *$n$" <<<"$L" && pass "has $n" || fail "missing $n"; done
}
{
echo "FFmpeg LGPL Mac build verification — $(date -u '+%Y-%m-%dT%H:%M:%SZ') on $(sw_vers -productName) $(sw_vers -productVersion) $(uname -m)"
echo "Binary: $F"
echo "sha256: $(shasum -a 256 "$F" | cut -d' ' -f1)"
echo
echo "### ffmpeg -version"; "$F" -hide_banner -version | head -1
echo
echo "### ffmpeg -hide_banner -buildconf"
BC=$("$F" -hide_banner -buildconf); echo "$BC"
for bad in enable-gpl enable-nonfree enable-version3 libx264 libx265; do
  grep -q -- "$bad" <<<"$BC" && fail "buildconf contains $bad" || pass "buildconf has no $bad"
done
echo
echo "### lipo -archs"; A=$(lipo -archs "$F"); echo "$A"
[[ " $A " == *" x86_64 "* && " $A " == *" arm64 "* ]] && pass "universal x86_64 + arm64" || fail "archs: $A"
echo
for a in arm64 x86_64; do
  echo "### otool -L -arch $a"; O=$(otool -L -arch $a "$F"); echo "$O"
  if tail -n +2 <<<"$O" | grep -vE '^\s+(/usr/lib/|/System/)' | grep -q .; then fail "$a links outside /usr/lib and /System"; else pass "$a links only /usr/lib and /System"; fi
  echo "minos ($a): $(otool -l -arch $a "$F" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
  echo
done
echo "### codesign"; codesign -dv "$F" 2>&1 | grep -E 'Signature|Identifier|Format'; codesign --verify "$F" && pass "signature verifies" || fail "codesign verify"
echo
echo "### -encoders (required)"
have "$("$F" -hide_banner -encoders)" h264_videotoolbox hevc_videotoolbox prores_videotoolbox prores_ks libvpx-vp9 aac pcm_s16le png mjpeg
echo
echo "### -protocols (required)"
P=$("$F" -hide_banner -protocols); echo "$P" | tr '\n' ' '; echo
for p in rtmp rtmps https tcp udp; do grep -qx " *$p" <<<"$P" && pass "has protocol $p" || fail "missing protocol $p"; done
echo
echo "### -devices (required)"
have "$("$F" -hide_banner -devices)" avfoundation lavfi
echo
echo "### real encodes (arch $(uname -m), native)"
enc() { local out=$1; shift
  echo "\$ ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 2 $* $out"
  if "$F" -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 2 "$@" "$T/$out"; then
    pass "$out ($(stat -f%z "$T/$out") bytes): $("$F" -hide_banner -i "$T/$out" 2>&1 | grep -m1 'Video:' | sed 's/^ *//')"
  else fail "$out encode"; fi
}
enc out.mp4 -c:v h264_videotoolbox -b:v 4M
enc out.mov -c:v prores_videotoolbox -profile:v standard
enc out.webm -c:v libvpx-vp9 -deadline realtime
echo
echo "### x86_64 slice under Rosetta"
if arch -x86_64 /usr/bin/true 2>/dev/null; then
  arch -x86_64 "$F" -hide_banner -version | head -1 && pass "x86_64 slice runs" || fail "x86_64 slice"
  if arch -x86_64 "$F" -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 2 -c:v libvpx-vp9 -deadline realtime "$T/x86.webm" && \
     arch -x86_64 "$F" -hide_banner -loglevel error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -t 2 -c:v h264_videotoolbox -b:v 4M "$T/x86.mp4"; then
    pass "x86_64 vp9 + h264_videotoolbox encodes"; else fail "x86_64 encodes"; fi
else echo "Rosetta not installed; x86_64 slice not run"; fi
echo
echo "RESULT: $FAIL failed check(s)"
} 2>&1 | tee "$R/mac/VERIFY.txt"
rm -rf "$T"
grep -q 'RESULT: 0 failed' "$R/mac/VERIFY.txt"
