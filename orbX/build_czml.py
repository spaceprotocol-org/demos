import ast
import json
import pandas as pd
from datetime import datetime, timedelta, timezone
from distance_metric import uniq_score_df
import sys

# FILEPATH = 'results.csv'

def build_czml():
    # df = pd.read_csv(FILEPATH)
    
    # load in the distance matrix
    df = uniq_score_df()
    
    df['NORAD_CAT_ID'] = (
        df['NORAD_CAT_ID']
        .astype(str)
        .str.replace(r"\.0$", "", regex=True)
        .str.zfill(5)
    )
    
    df['rank'] = df['uniqueness'].rank(ascending = False)
    
    # for each perigee and apogee, subtract the earth's radius
    df['perigee'] = df['perigee'] - 6371
    df['apogee'] = df['apogee'] - 6371
    
    # print df cols
    print(df.columns)
    
    epochTime = datetime.now(timezone.utc)
    endTime = epochTime + timedelta(days = 5)
    epochStr, endTimeStr = map(lambda x: x.strftime('%Y-%m-%dT%H:%M:%S.%fZ'), [epochTime, endTime])

    czml = [{'id': 'document', 'version': '1.0'}]

    for _, row in df.iterrows():
        coordinates = ast.literal_eval(row['COORDINATES'])
        coords = [int(coord) if i % 4 == 0 else float(coord) 
                  for i, coord in enumerate(coordinates)]
        
        # Calculate orbit classification based on apogee and perigee.
        apogee = float(row['apogee'])
        perigee = float(row['perigee'])
        avg_alt = (apogee + perigee) / 2

        if abs(avg_alt - 35786) <= 75:
            orbit_class = "GEO"
        elif avg_alt < 2000:
            orbit_class = "LEO"
        elif avg_alt < 35786 - 75:
            orbit_class = "MEO"
        elif avg_alt > 35786 + 75:
            orbit_class = "HEO"
        else:
            orbit_class = "MEO"  # Default fallback

        czml.append({
            'id': row['NORAD_CAT_ID'],
            'name': row['OBJECT_NAME'],
            'availability': f"{epochStr}/{endTimeStr}",
            'position': {
                'epoch': epochStr, 
                'cartographicDegrees': coords, 
                'interpolationDegree': 5,
                'interpolationAlgorithm': 'LAGRANGE'
            },
            'properties': {**{key: row[key] for key in ['S_D', 
                                                         'S_I', 
                                                         'S_T', 
                                                         'DIT',
                                                         'OpOrbit',
                                                         'TotMass',
                                                         'uniqueness',
                                                         'rank']},
                           'apogee': apogee,
                           'perigee': perigee,
                           'orbit_class': orbit_class},
            'point': {'color': {'rgba': [255, 255, 0, 255]}, 
                      'pixelSize': 2}
        })

    with open('data/output.czml', 'w') as file:
        json.dump(czml, file, 
                  indent = 2, 
                  separators = (',', ': '))
        

        
        
if __name__ == '__main__':
    # build_czml()
    check_czml()