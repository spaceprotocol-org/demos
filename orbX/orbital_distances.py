import numpy as np
import pandas as pd

from DMT import VectorizedKeplerianOrbit
import json

def get_distance_json():
    """
    For all satellites in LEO, MEO, GEO, and HEO,
    compute the distance from each object to all others 
    and save to disk as json.
    """
    
    # load in current elset data
    with open("data/elset_current.text", "r") as f:
        lines = [l.strip() for l in f.readlines()]
        
        
    tles = []
    for i in range(0, len(lines), 3):
        name = lines[i][2:]
        tle_line1 = lines[i+1]
        tle_line2  = lines[i+2]
        NORAD_ID = str(tle_line1[2:2+5]).replace(" ", "0")
        
        uniqueness_score = -1.0 
        tles.append([NORAD_ID, 
                     name, 
                     tle_line1, 
                     tle_line2,  
                     uniqueness_score,
                     0])
        
    tle_df = pd.DataFrame(tles, columns=["NORAD_CAT_ID", 
                                         "OBJECT_NAME",
                                         "TLE_LINE1", 
                                         "TLE_LINE2",
                                         "prop_uniqueness",
                                         "prop_rank"])
    
    # remove any 'TO BE ASSIGNED' satellites
    tle_df = tle_df[~tle_df['OBJECT_NAME'].astype(str).str.contains('TBA - TO BE ASSIGNED')]
    
def compute_neighbour_lookup(top_n=10):
    """
    Load satellites from TLE file, compute the distance matrix for all satellites,
    and return a dictionary where each key (satNo) maps to a list of its 10 nearest neighbours,
    with each neighbour represented as a dict with 'satNo' and 'distance'.
    """
    
    # Load TLE data
    with open("data/elset_current.text", "r") as f:
        lines = [line.strip() for line in f.readlines()]
        
    tles = []
    for i in range(0, len(lines), 3):
        name = lines[i][2:]
        tle_line1 = lines[i+1]
        tle_line2 = lines[i+2]
        # Extract NORAD ID from the TLE line, pad with zeroes as necessary
        satNo = str(tle_line1[2:2+5]).replace(" ", "0")
        tles.append([satNo, name, tle_line1, tle_line2])
        
    df = pd.DataFrame(tles, columns=["satNo", "name", "TLE_LINE1", "TLE_LINE2"])
    
    # Remove any 'TO BE ASSIGNED' satellites
    df = df[~df['name'].astype(str).str.contains('TBA - TO BE ASSIGNED')]
    
    # Compute the orbits and full distance matrix
    line1 = df['TLE_LINE1'].values
    line2 = df['TLE_LINE2'].values
    
    print("Calculating orbits")
    orbits = VectorizedKeplerianOrbit(line1, line2)
    
    print("Calculating distances")
    distance_matrix = np.array(VectorizedKeplerianOrbit.DistanceMetric(orbits, orbits))
    
    """
    In an ideal world, it would be an array of pointers, but that can be done later
    """
    
    # Build neighbour lookup dictionary
    neighbour_lookup = {}
    for idx, satNo in enumerate(df['satNo']):
        distances = distance_matrix[idx]
        # Sort indices by distance, remove self (assumes self-distance == 0)
        sorted_indices = np.argsort(distances)
        neighbour_indices = [j for j in sorted_indices if j != idx][:top_n]
        
        # Build a list of neighbour objects with satNo and corresponding distance
        neighbours = []
        for neighbour_idx in neighbour_indices:
            neighbour_satNo = df.iloc[neighbour_idx]['satNo']
            neighbour_distance = float(distances[neighbour_idx])
            neighbours.append({"satNo": neighbour_satNo, "distance": neighbour_distance})
        
        neighbour_lookup[satNo] = neighbours
        
    return neighbour_lookup

def save_neighbour_lookup():
    """
    Compute and save the neighbour lookup dictionary to a JSON file.
    """
    neighbour_dict = compute_neighbour_lookup(top_n=10)
    with open("data/neighbour_lookup.json", "w") as f:
        json.dump(neighbour_dict, f)
    print("neighbour lookup saved to data/neighbour_lookup.json")
    
# get the distance matrix

def get_distance_matrix():
    
    line1 = df['line1'].values
    line2 = df['line2'].values
    
    print("Calculating orbits")
    orbits = VectorizedKeplerianOrbit(line1, line2)
    
    print("Calculating distances")
    distance_matrix = VectorizedKeplerianOrbit.DistanceMetric(orbits, orbits)
    
    return distance_matrix
                
def get_key():
    global df
    df = df['satNo'].unique()
    
    satNo_idx_dict = {}
    idx_satNo_dict = {}
    
    for i, satNo in enumerate(df):
        idx_satNo_dict[i] = satNo
        satNo_idx_dict[satNo] = i
        
    return idx_satNo_dict, satNo_idx_dict
            
    print("Saved satNo to index and index to satNo dictionaries to disk.")
    
if __name__ == "__main__":
    save_neighbour_lookup()
