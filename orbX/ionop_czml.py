import boto3
import requests
import time

def ionop_czml():
    # ACCESSTOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiODNlNGQ1Zi02YzZkLTQxOTUtYjNjNi1iMzcxZmEzYjIxOGYiLCJpZCI6MjE2MTA4LCJpYXQiOjE3MTgxMjE5NzV9.9QEc6VlBo7Og33vYXnxBTkt1QiBwiO2IQ6QfAcAQozc'
    # ACCESSTOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5OTMwYjJlMS0yYjBhLTQwMmMtYjJkZi1mZWZiY2RiYTNmN2UiLCJpZCI6MjQwODIwLCJpYXQiOjE3MzgzMDM2ODl9.h1pXOgujWRPoS6ZFc5wL-l5_XJnSyUsPZym3ssZj7TQ'
    ACCESSTOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5OTMwYjJlMS0yYjBhLTQwMmMtYjJkZi1mZWZiY2RiYTNmN2UiLCJpZCI6MjQwODIwLCJpYXQiOjE3MzgzMDM2ODl9.h1pXOgujWRPoS6ZFc5wL-l5_XJnSyUsPZym3ssZj7TQ'
    
    BASEURL     = 'https://api.cesium.com/v1/assets'
    FILEPATH    = 'output.czml'

    headers = {'Authorization': f'Bearer {ACCESSTOKEN}'}

    try:
        postBody = {
            'name': 'output',
            'description': "l-dit demo czml file",
            'type': 'CZML',
            'options': {
                'sourceType': 'CZML'
            }
        }

        response = requests.post(BASEURL, headers = headers, json = postBody)
        response.raise_for_status()

        assetId = response.json()['assetMetadata']['id']
        uploadLocation = response.json().get('uploadLocation', {})

        s3Client = boto3.client(
            's3',
            aws_access_key_id     = uploadLocation['accessKey'],
            aws_secret_access_key = uploadLocation['secretAccessKey'],
            aws_session_token     = uploadLocation['sessionToken'],
            endpoint_url          = uploadLocation['endpoint']
        )

        with open(FILEPATH, 'rb') as f:
            s3Client.upload_fileobj(f, uploadLocation['bucket'], f"{uploadLocation['prefix']}output.czml")

        print('PASSED')

        onComplete       = response.json().get('onComplete', {})
        onCompleteURL    = onComplete.get('url')
        onCompleteMethod = onComplete.get('method')
        onCompleteFields = onComplete.get('fields')

        response = requests.request(
            method  = onCompleteMethod,
            url     = onCompleteURL,
            headers = headers,
            json    = onCompleteFields
        )
        response.raise_for_status()

        print('PASSED')

        while True:
            statusResponse = requests.get(BASEURL + '/' + str(assetId), headers = headers)
            statusResponse.raise_for_status()
            status = statusResponse.json()['status']
            if status == 'COMPLETE':
                print('PASSED')
                break
            elif status == 'DATA_ERROR':
                print('FAILED')
                break
            else:
                print(f"Tiling status: {statusResponse.json()['percentComplete']}")
                time.sleep(20)

        params = {
            'sortBy': 'DATE_ADDED',
            'sortOrder': 'DESC'
        }
        response = requests.get(BASEURL, headers = headers, params = params)
        response.raise_for_status()

        assets = [item['id'] for item in response.json()['items'] if item['status'] == 'COMPLETE']
        if len(assets) >= 2:
            assetIdToDelete = assets[1]
            deleteURL       = f'{BASEURL}/{assetIdToDelete}'
            response        = requests.delete(deleteURL, headers = headers)
            response.raise_for_status()
            print('PASSED')
        else:
            print('FAILED')

    except requests.exceptions.RequestException as e:
        print('ERROR:', e)
    except Exception as e:
        print('ERROR:', e)

if __name__ == '__main__':
    ionop_czml()