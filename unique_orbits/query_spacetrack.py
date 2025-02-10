import requests
import json

def query_udl():
    try:
        # Create a session
        session = requests.Session()
        
        # Login URL
        login_url = "https://www.space-track.org/ajaxauth/login"
        
        # Login credentials
        creds = {
            "identity": "sam.white@spaceprotocol.org",
            "password": "apitestpassword"
        }
        
        # Authenticate
        resp = session.post(login_url, data=creds)
        resp.raise_for_status()
        
        # Your query URL
        # query_url = "https://www.space-track.org/basicspacedata/query/class/tle_latest/orderby/ORDINAL%20asc/emptyresult/show"
        query_url = 'https://www.space-track.org/basicspacedata/query/class/gp/EPOCH/%3Enow-30/orderby/NORAD_CAT_ID,EPOCH/format/3le'
        # Make the query using the authenticated session
        response = session.get(query_url)
        response.raise_for_status()
        
        # Save response
        filename = "data/elset_current.text"
        with open(filename, "w") as f:
            f.write(response.text)
        print(f"Saved {filename}")
        
        # Close the session
        session.close()
        return True
        
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == '__main__':
    query_udl()