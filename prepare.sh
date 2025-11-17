#!/usr/bin/env bash

# Nominatim data directories
mkdir -p ./.store/nominatim/data
sudo chmod -R 777 ./.store/nominatim

docker compose -f compose.yml up --build