#!/bin/bash
# Download and load fresh schedule data from Network Rail

set -e

USERNAME="${NETWORK_RAIL_USERNAME:-crowdani@uk.ibm.com}"
PASSWORD="${NETWORK_RAIL_PASSWORD:-Sm3g@h3ad}"

echo "STEP:1:STARTED"
echo "=========================================="
echo "Network Rail Schedule Refresh"
echo "=========================================="
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "STEP:1:PROGRESS:Connecting to Network Rail API..."
echo "Downloading schedule data from publicdatafeeds.networkrail.co.uk"
echo ""

curl -L -u "${USERNAME}:${PASSWORD}" \
  -o toc-full.gz \
  'https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full' 2>&1

if [ $? -ne 0 ]; then
    echo "STEP:1:FAILED"
    echo "ERROR: Failed to download schedule data"
    exit 1
fi

FILE_SIZE=$(du -h toc-full.gz 2>/dev/null | cut -f1)
echo ""
echo "STEP:1:COMPLETE:Downloaded ${FILE_SIZE}"
echo ""

echo "STEP:2:STARTED"
echo "STEP:2:PROGRESS:Decompressing schedule data..."
echo ""

gunzip -f toc-full.gz

if [ $? -ne 0 ]; then
    echo "STEP:2:FAILED"
    echo "ERROR: Failed to decompress schedule data"
    exit 1
fi

DECOMPRESSED_SIZE=$(du -h toc-full 2>/dev/null | cut -f1)
echo "STEP:2:COMPLETE:Decompressed to ${DECOMPRESSED_SIZE}"
echo ""

echo "STEP:3:STARTED"
echo "STEP:3:PROGRESS:Loading schedules into database..."
echo "This will take several minutes..."
echo ""

python3 load_cif_json_fast.py toc-full

if [ $? -ne 0 ]; then
    echo "STEP:3:FAILED"
    echo "ERROR: Failed to load schedules"
    exit 1
fi

echo ""
echo "STEP:3:COMPLETE"
echo ""

echo "STEP:4:STARTED"
echo "STEP:4:PROGRESS:Loading CORPUS reference data (TIPLOC/STANOX mappings)..."
echo ""

python3 load_corpus.py

if [ $? -ne 0 ]; then
    echo "STEP:4:FAILED"
    echo "ERROR: Failed to load CORPUS data"
    exit 1
fi

echo "STEP:4:COMPLETE"
echo ""

echo "STEP:5:STARTED"
echo "STEP:5:PROGRESS:Populating STANOX arrays on schedules..."
echo ""

python3 populate_stanox_arrays.py

if [ $? -ne 0 ]; then
    echo "STEP:5:FAILED"
    echo "ERROR: Failed to populate STANOX arrays"
    exit 1
fi

echo "STEP:5:COMPLETE"
echo ""
echo "=========================================="
echo "COMPLETE: Schedule refresh finished successfully"
echo "=========================================="
echo ""
