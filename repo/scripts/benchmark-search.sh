#!/bin/bash
# Hot-search performance benchmark
# Requirement: cached repeated queries under 200ms

API_URL="${API_BASE_URL:-https://localhost:3443}"

echo "=== RailOps Hot-Search Benchmark ==="
echo "Target: < 200ms for repeated queries"
echo ""

# First search (cold)
echo "Cold search (NYC → WAS):"
time curl -sk "$API_URL/api/trips/search?origin=NYC&destination=WAS" > /dev/null 2>&1

# Repeated searches (should be faster due to hot-search tracking)
echo ""
echo "Warm search (same query):"
for i in 1 2 3; do
  START=$(date +%s%N)
  curl -sk "$API_URL/api/trips/search?origin=NYC&destination=WAS" > /dev/null 2>&1
  END=$(date +%s%N)
  MS=$(( (END - START) / 1000000 ))
  echo "  Run $i: ${MS}ms"
done

echo ""
echo "Hot-searches endpoint:"
time curl -sk "$API_URL/api/trips/hot-searches" > /dev/null 2>&1
