import os
import pandas as pd
from datetime import datetime
from query_spacetrack import query_udl
from sgp4.api import Satrec

import json

import datetime as dt


def getPos(dSeconds, satrec, julianDate):
    
    fraction = dSeconds / 86400
    
    days = 0
    if fraction > 1:
        days = int(fraction)
        fraction -= days
    
    return satrec.sgp4(julianDate + days, fraction)[1]

def get_posvcs(TLE_LINE1, TLE_LINE2, only_one_period = True):
    
    satrec = Satrec.twoline2rv(TLE_LINE1, TLE_LINE2)
    julianDate = satrec.jdsatepoch
    
   
    #getPos = lambda dSeconds: satrec.sgp4(julianDate, (dSeconds / 86400))[1]
    getLat = lambda position: np.degrees(np.arctan2(position[2], np.sqrt(position[0]**2 + position[1]**2)))
    getLon = lambda position: np.degrees(np.arctan2(position[1], position[0]))
    getAlt = lambda position: ((np.sqrt(position[0]**2 + position[1]**2 + position[2]**2) - 6371) * 1000)

    positions = []
    coord_list = []
    
    
    mean_motion = satrec.no_kozai # radians per minute
    periodInMinutes = np.pi * 2  / mean_motion
    periodInSeconds = int(periodInMinutes * 60)
    
    if only_one_period:
        time_limit = periodInSeconds
    else:
        time_limit = 86400
    
    # stepSeconds = int(time_limit/20)
    
    stepSeconds = 600
    
    for dSeconds in range(0, time_limit , stepSeconds):
        position = getPos(dSeconds, satrec, julianDate)
        positions.append(position)
        lat = getLat(position)
        lon = getLon(position)
        alt = getAlt(position)
        coord_list.extend([dSeconds, lon, lat, alt])
    
    if only_one_period:
        coord_list.extend([periodInSeconds, getLon(positions[0]), getLat(positions[0]), getAlt(positions[0])])
        
    
    return positions, coord_list

def build_czml(df):
    
    epochTime = dt.datetime.now(dt.timezone.utc)
    endTime = epochTime + dt.timedelta(days = 10)
    epochStr, endTimeStr = map(lambda x: x.strftime('%Y-%m-%dT%H:%M:%S.%fZ'), [epochTime, endTime])

    czml = [{'id': 'document', 'version': '1.0'}]
    
    property_keys = [k for k in df.columns if k.startswith("prop_")]

    for _, row in df.iterrows():
        _, coordinates = get_posvcs(row['TLE_LINE1'], row['TLE_LINE2'])
        coords = [int(coord) if i % 4 == 0 else float(coord) 
                  for i, coord in enumerate(coordinates)]

        # Include uniqueness_range explicitly.
        additional_properties = {
            'uniqueness_range': row.get('uniqueness_range', 'none'),
            'neighbours': row.get("neighbours", [])
        }
                
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
            'properties': {**{key[5:]: row[key] for key in property_keys}, **additional_properties},
            'point': {
                'color': {'rgba': [255, 255, 0, 255]}, 
                'pixelSize': 2
            }
        })

    with open('output.czml', 'w') as file:
        json.dump(czml, file, 
                  indent = 2, 
                  separators = (',', ': '))



def get_orbital_regimes() -> pd.DataFrame:
    """
    Get the orbital regimes from the CSV file
    """
    # Load the CSV file
    df = pd.read_csv('data/satcat.tsv', sep='\t', low_memory=False)

    # Things that are around the earth
    around_earth = df[df['Primary']=='Earth']

    # Remove rows with dashes/ negative values
    around_earth = around_earth[~around_earth['Perigee'].astype(str).str.contains('-')]
    around_earth.Perigee = around_earth.Perigee.astype(float)


    in_leo = around_earth[around_earth.OpOrbit.str.contains('LEO')].copy()
    in_geo = around_earth[around_earth.OpOrbit.str.contains('GEO')].copy()
    in_heo = around_earth[around_earth.OpOrbit.str.contains('HEO')].copy()
    in_meo = around_earth[around_earth.OpOrbit.str.contains('MEO')].copy()
    
    
    return in_leo, in_meo, in_heo, in_geo, 


def get_satellites_info(run_from_scratch=False):
    
    # let this refresh the elsets every time it gets called
    
    print('Getting orbital regimes')
    LEO, MEO, HEO, GEO = get_orbital_regimes()
    print("Done")
        
    if run_from_scratch:
        if os.path.exists("data/elset_current.text"):
            os.remove("data/elset_current.text")
        query_udl()

    if not os.path.exists("data/elset_current.text"):
        print("File not found data/elset_current.text, QUITTING")
        return False
    
    print('Reading current Elsets')
    with open("data/elset_current.text", "r") as f:
        lines = [l.strip() for l in f.readlines()]
        
    print('Done')
        
    tles = []
    for i in range(0, len(lines), 3):
        name = lines[i][2:]
        tle_line1 = lines[i+1]
        tle_line2  = lines[i+2]
        NORAD_ID = str(tle_line1[2:2+5]).replace(" ", "0")
        
        if NORAD_ID in LEO.Satcat.values:
            orbital_regime = "LEO"
        elif NORAD_ID in MEO.Satcat.values:
            orbital_regime = "MEO"
        elif NORAD_ID in HEO.Satcat.values:
            orbital_regime = "HEO"
        elif NORAD_ID in GEO.Satcat.values:
            orbital_regime = "GEO"
        
        uniqueness_score = -1.0 
        tles.append([NORAD_ID, 
                     name, 
                     tle_line1, 
                     tle_line2,  
                     orbital_regime, 
                     uniqueness_score,
                     0])
        
    tle_df = pd.DataFrame(tles, columns=["NORAD_CAT_ID", 
                                         "OBJECT_NAME",
                                         "TLE_LINE1", 
                                         "TLE_LINE2",
                                         "prop_orbit_class",
                                         "prop_uniqueness",
                                         "prop_rank"])
    
    # remove any 'TO BE ASSIGNED' satellites
    tle_df = tle_df[~tle_df['OBJECT_NAME'].astype(str).str.contains('TBA - TO BE ASSIGNED')]
    return tle_df

from DMT import VectorizedKeplerianOrbit
import numpy as np
import pickle

'''
"properties": {
    "uniqueness": 0.07179641103799758,
    "rank": 2279.0,
    "orbit_class": "LEO"
},

'''

def compute_neighbour_lookup(top_n=10):
    """
    Load satellites from TLE file, compute the distance matrix for all satellites,
    and return a dictionary where each key (satNo) maps to a list of its 10 nearest neighbours,
    with each neighbour represented as a dict with 'satNo' and 'distance'.
    """
    
    # Load TLE data.
    with open("data/elset_current.text", "r") as f:
        lines = [l.strip() for l in f.readlines()]
        
    tles = []
    for i in range(0, len(lines), 3):
        name = lines[i][2:]
        tle_line1 = lines[i+1]
        tle_line2 = lines[i+2]
        # Extract NORAD ID from the TLE line, pad with zeroes as necessary.
        satNo = str(tle_line1[2:2+5]).replace(" ", "0")
        tles.append([satNo, name, tle_line1, tle_line2])
        
    df = pd.DataFrame(tles, columns=["satNo", "name", "TLE_LINE1", "TLE_LINE2"])
    
    # Remove any 'TO BE ASSIGNED' satellites.
    df = df[~df['name'].astype(str).str.contains('TBA - TO BE ASSIGNED')]
    
    # Compute the orbits and full distance matrix.
    line1 = df['TLE_LINE1'].values
    line2 = df['TLE_LINE2'].values
    print("Calculating orbits")
    orbits = VectorizedKeplerianOrbit(line1, line2)
    
    print("Calculating distances")
    distance_matrix = np.array(VectorizedKeplerianOrbit.DistanceMetric(orbits, orbits))
    
    # Build neighbor lookup dictionary.
    neighbour_lookup = {}
    for idx, satNo in enumerate(df['satNo']):
        distances = distance_matrix[idx]
        # Sort indices by distance, ignoring self (assumes self distance == 0)
        sorted_indices = np.argsort(distances)
        neighbour_indices = [j for j in sorted_indices if j != idx][:top_n]
        
        # Build a list of neighbor objects with satNo and corresponding distance.
        neighbours = []
        for neighbour_idx in neighbour_indices:
            neighbour_satNo = df.iloc[neighbour_idx]['satNo']
            neighbour_distance = float(distances[neighbour_idx])
            neighbours.append({"satNo": neighbour_satNo, "distance": neighbour_distance})
        
        neighbour_lookup[satNo] = neighbours
        
    return neighbour_lookup



def main(from_strach=True):    
    sats_df = get_satellites_info(from_strach)
    # orbital_regimes = ["GEO", "MEO", "HEO", "LEO"]
    orbital_regimes = ["LEO", "MEO", "HEO", "GEO", "GTO", "DSO", "CLO", "EEO", "HCO", "PCO", "SSE"]
    
    results = pd.DataFrame()

    for regime in orbital_regimes:
        print(f"Number of satellites in {regime}: {sats_df[sats_df.prop_orbit_class==regime].shape[0]}")
        
        current_regime = sats_df[sats_df.prop_orbit_class==regime].copy()
        
        if len(current_regime) == 0:
            continue
        
        lines1 = current_regime.TLE_LINE1.values
        lines2 = current_regime.TLE_LINE2.values
        
        orbits = VectorizedKeplerianOrbit(lines1, lines2)
        distances = VectorizedKeplerianOrbit.DistanceMetric(orbits, orbits)
        distances = np.array(distances)
        
        def k_nearest_mean(dist_row):
            k = 100
            sorted_row = np.sort(dist_row)
            # Exclude the first element (self-distance, assumed 0) and take the next k distances
            return np.mean(sorted_row[1:k+1])
        
        scores = np.apply_along_axis(k_nearest_mean, 1, distances)
        
        mean_scores = np.mean(scores)
        var_scores = np.var(scores)
        
        valid_idx = np.square(scores - mean_scores) / var_scores < 2.71
        scores = scores[valid_idx]
        current_regime = current_regime[valid_idx]
        
        current_regime['prop_uniqueness'] = (scores - np.min(scores)) / (np.max(scores) - np.min(scores))
        current_regime['prop_rank'] = current_regime['prop_uniqueness'].rank(ascending=False).astype(int)
        
        # Set default uniqueness_range to "none"
        current_regime["uniqueness_range"] = "none"
        # Sort by prop_rank so that the highest uniqueness (lowest rank number) come first
        current_regime.sort_values("prop_rank", inplace=True)
        # Get the indices for the top 5 and bottom 5
        top_five_indices = current_regime.head(5).index
        bottom_five_indices = current_regime.tail(5).index
        # Set uniqueness_range for top 5 as "most" and bottom 5 as "least"
        current_regime.loc[top_five_indices, "uniqueness_range"] = "most"
        current_regime.loc[bottom_five_indices, "uniqueness_range"] = "least"
        
        results = pd.concat([results, current_regime])
        
        print(f"Mean distances score for {regime}: {np.mean(scores)}")
        print(f"Variation in distances score for {regime}: {np.var(scores)}")
        
    neighbour_lookup = compute_neighbour_lookup(top_n=10)
    # Add neighbour info as a new column.
    results["neighbours"] = results["NORAD_CAT_ID"].apply(lambda satNo: neighbour_lookup.get(satNo, []))
    results.to_pickle("data/satellites_with_scores.pkl")

    results.to_pickle("data/satellites_with_scores.pkl")
    
from ionop_czml import ionop_czml   
from orbital_distances import orbital_distances
from ionop_czml_neighbours import ionop_czml_neighbours
    
if __name__ == '__main__':
    main(from_strach= True)
    df = pd.read_pickle("data/satellites_with_scores.pkl")
    build_czml(df)
    # orbital_distances()
    ionop_czml()
    # ionop_czml_neighbours()