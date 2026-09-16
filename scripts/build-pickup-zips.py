"""Build the offline 30-mile ZIP lookup from the Census 2025 ZCTA Gazetteer.
Usage: python3 scripts/build-pickup-zips.py /path/to/2025_Gaz_zcta_national.zip
Source: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip
ZCTA representative points approximate ZIP proximity, not driving distance.
"""
import csv
import io
import json
import math
from pathlib import Path
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    rows = csv.DictReader(io.StringIO(archive.read(archive.namelist()[0]).decode()), delimiter='|')
    points = {r['GEOID']: (float(r['INTPTLAT']), float(r[next(k for k in r if k.strip() == 'INTPTLONG')])) for r in rows}

def miles(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 3958.7613 * 2 * math.asin(math.sqrt(h))

anchors = ['75093', '75063', '75033']
lookup = {}
for code, point in sorted(points.items()):
    distances = sorted((miles(point, points[anchor]), anchor) for anchor in anchors)
    if distances[0][0] <= 30:
        lookup[code] = distances[0][1]
Path('src/data/nearby-pickup-zips.json').write_text(json.dumps(lookup, indent=2) + '\n')
print(f'{len(lookup)} ZIP areas, {Path("src/data/nearby-pickup-zips.json").stat().st_size} bytes')
