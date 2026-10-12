#!/bin/bash
# usage: shots.sh outdir w h "query1" "query2" ...   (sequential: parallel headless GPUs fail)
out=$1; w=$2; h=$3; shift 3
for q in "$@"; do node "$(dirname "$0")/shot.mjs" "http://localhost:8765/?$q&ui=0" "$out/${q//[&=.]/_}.png" 7000 $w $h | grep -v "^$" | grep -iv "GPU stall\|Automatic fallback" ; done
