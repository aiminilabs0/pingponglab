#!/bin/bash

FILE_TO_WATCH="1_llm_output"
SCRIPT_TO_RUN="./update.sh"
CHECK_INTERVAL=2  # seconds between checks

# Check if file exists initially
if [ ! -f "$FILE_TO_WATCH" ]; then
    echo "File $FILE_TO_WATCH does not exist."
    exit 1
fi

# Compute initial checksum
LAST_SUM=$(md5sum "$FILE_TO_WATCH" | awk '{print $1}')

echo "Monitoring $FILE_TO_WATCH for changes..."

while true; do
    sleep "$CHECK_INTERVAL"

    if [ ! -f "$FILE_TO_WATCH" ]; then
        echo "File $FILE_TO_WATCH was deleted. Waiting..."
        continue
    fi

    NEW_SUM=$(md5sum "$FILE_TO_WATCH" | awk '{print $1}')

    if [ "$NEW_SUM" != "$LAST_SUM" ]; then
        echo "Change detected in file: $FILE_TO_WATCH. Executing $SCRIPT_TO_RUN..."
        bash "$SCRIPT_TO_RUN"
        LAST_SUM="$NEW_SUM"
    fi
done
