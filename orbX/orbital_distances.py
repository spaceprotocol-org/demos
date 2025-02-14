import numpy as np
import pandas as pd
import json

from DMT import VectorizedKeplerianOrbit

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

def save_neighbour_lookup_czml():
    """
    Compute the neighbour lookup dictionary and save it as a CZML file.
    Each satellite packet includes its neighbor data in the properties field.
    """
    neighbour_lookup = compute_neighbour_lookup(top_n=10)
    
    # Create the CZML document packet.
    czml = [{
        "id": "document",
        "version": "1.0"
    }]
    
    # For each satellite, add a packet with neighbor info.
    for satNo, neighbours in neighbour_lookup.items():
        czml_packet = {
            "id": satNo,
            "name": satNo,
            "description": "10 Nearest Neighbours",
            "properties": {
                "neighbours": neighbours
            }
        }
        czml.append(czml_packet)
    
    with open("data/neighbour_lookup.czml", "w") as f:
        json.dump(czml, f, indent=2, separators=(',', ': '))
    print("Neighbour lookup saved to data/neighbour_lookup.czml")
    
if __name__ == "__main__":
    save_neighbour_lookup_czml()