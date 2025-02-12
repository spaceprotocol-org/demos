let auth0Client;

document.addEventListener("DOMContentLoaded", async function() {
    try {
        // Load Auth0 configuration
        const response = await fetch('/auth_config.json');
        const config = await response.json();

        auth0Client = await createAuth0Client({
            domain: config.domain,
            client_id: config.clientId,
            redirect_uri: window.location.origin
        });

        // Check if the user is returning from Auth0 login
        if (window.location.search.includes("code=")) {
            await auth0Client.handleRedirectCallback();
            window.history.replaceState({}, document.title, "/");
        }

        await updateUI();

        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');

        loginBtn.addEventListener('click', login);
        logoutBtn.addEventListener('click', logout);

    } catch (error) {
        console.error("Error during authentication setup:", error);
    }
});

async function updateUI() {
    const isAuthenticated = await auth0Client.isAuthenticated();
    const loginContainer = document.getElementById('loginContainer');
    const loadingScreen = document.getElementById('loadingScreen');
    const appContainer = document.getElementById('appContainer');
    const userInfoContainer = document.getElementById('userInfoContainer');

    if (isAuthenticated) {
        loginContainer.style.display = 'none';
        loadingScreen.style.display = 'flex';
        appContainer.style.display = 'block';
        
        initializeApp(); 
        
    } else {
        loginContainer.style.display = 'flex';
        loadingScreen.style.display = 'none';
        appContainer.style.display = 'none';
    }
}

async function login() {
    await auth0Client.loginWithRedirect();
}

async function logout() {
    try {
        // Logout from Auth0
        await auth0Client.logout({
            returnTo: window.location.origin
        });
    } catch (error) {
        console.error("Logout error:", error);
    }
}


function initializeApp() {
    const loadingScreen = document.getElementById('loadingScreen');
    const appContainer = document.getElementById('appContainer');
    Cesium.Ion.defaultAccessToken = CONFIG.ACCESSTOKEN;
    
    const oauth2Token = Cesium.Ion.defaultAccessToken;
    const baseUrl = 'https://api.cesium.com/v1/assets';
    
    async function fetchLatestAsset() {
        const params = new URLSearchParams({
            sortBy: 'DATE_ADDED',
            sortOrder: 'DESC',
            status: 'COMPLETE'
        });

        const response = await fetch(`${baseUrl}?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${oauth2Token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Error fetching assets: ${response.statusText}`);
        }

        const data = await response.json();
        return data.items[0];
    }   

    const viewer = new Cesium.Viewer("cesiumContainer", {
        shouldAnimate: true,
        geocoder: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        navigationHelpButton: false,
        homeButton: true
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.sun = new Cesium.Sun();
    viewer.scene.moon = new Cesium.Moon();

    let dataSource;
    let highlightedEntities = [];
    
    (async function loadData() {
        try {
            const latestAsset = await fetchLatestAsset();
            const assetId = latestAsset.id;
            
            const resource = await Cesium.IonResource.fromAssetId(assetId);
            dataSource = await Cesium.CzmlDataSource.load(resource);
            await viewer.dataSources.add(dataSource);
            viewer.clock.currentTime = Cesium.JulianDate.now();
            viewer.clock.multiplier = 50;
            const step = 10;

            const animationViewModel = viewer.animation.viewModel;
            animationViewModel.playForwardViewModel.command.beforeExecute.addEventListener(function(commandInfo) {
                viewer.clock.multiplier += step;
            });

            animationViewModel.playReverseViewModel.command.beforeExecute.addEventListener(function(commandInfo) {
                viewer.clock.multiplier -= step;
            });

            loadingScreen.style.display = 'none';
            appContainer.style.display = 'block';
            displayTopAndBottomSatellitesByDIT()
            displayStarlinkSatellites();
            const searchContainer = document.getElementById('searchContainer');
            searchContainer.style.display = 'block';
            const urlParams = new URLSearchParams(window.location.search);
            const idFromURL = urlParams.get('id');
            if (idFromURL) {
                performSearch(idFromURL);
            }
            
            updateColors('DIT', 5);
            document.querySelector('input[value="DIT"]').checked = true;

        } catch (error) {
            console.log(error);
        }
    })();

    const infoBox = document.getElementById("infoBox");

    viewer.screenSpaceEventHandler.setInputAction(function onLeftClick(movement) {
        const pickedObject = viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const entity = pickedObject.id;
            displayInfoBox(entity);
            showEntityPath(entity);
            highlightedEntities.push(entity);
        } else {
            infoBox.style.display = 'none';
            removeAllEntityPaths();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    function displayInfoBox(entity) {
        const description = entity.properties.description?.getValue(Cesium.JulianDate.now());
        const S_D = entity.properties.S_D?.getValue(Cesium.JulianDate.now());
        const S_I = entity.properties.S_I?.getValue(Cesium.JulianDate.now());
        const S_T = entity.properties.S_T?.getValue(Cesium.JulianDate.now());
        const DIT = entity.properties.DIT?.getValue(Cesium.JulianDate.now());

        infoBox.style.display = 'block';
        infoBox.innerHTML = `<div class="info-content">
                             <strong>The higher the score the better</strong></span>
                             <strong>NORAD CAT ID:</strong> <span>${entity.id}</span>
                             <strong>NAME:</strong> <span>${entity.name}</span>
                             <strong>L-Detectability:</strong> <span>${S_D}</span>
                             <strong>L-Identifiability:</strong> <span>${S_I}</span>
                             <strong>L-Trackability:</strong> <span>${S_T}</span>
                             <strong>L-DIT:</strong> <span>${DIT}</span>
                         </div>`;
    }

    function showEntityPath(entity) {
        if (!entity.path) {
            entity.path = new Cesium.PathGraphics({
                width: 1,
                material: Cesium.Color.WHITE
            });
        }
        viewer.entities.add(entity);
    }

    function removeEntityPath(entity) {
        if (entity.path) {
            entity.path = undefined;
            viewer.entities.remove(entity);
        }
    }

    function removeAllEntityPaths() {
        highlightedEntities.forEach(entity => {
            removeEntityPath(entity);
        });
        highlightedEntities = [];
    }

    function updateColors(property, numberOfBins = 5) {
        if (!dataSource) {
            console.error('DataSource is not yet loaded.');
            return;
        }

        let minValue = Infinity;
        let maxValue = -Infinity;
        let hasValues = false;

        dataSource.entities.values.forEach(entity => {
            const value = entity.properties[property]?.getValue(Cesium.JulianDate.now());
            if (value !== undefined) {
                hasValues = true;
                if (value < minValue) minValue = value;
                if (value > maxValue) maxValue = value;
            }
        });

        if (!hasValues) {
            removeLegend();
            return;
        }

        const binSize = (maxValue - minValue) / numberOfBins;
        const bins = [];
        for (let i = 0; i < numberOfBins; i++) {
            bins.push({
                min: minValue + i * binSize,
                max: minValue + (i + 1) * binSize,
                color: Cesium.Color.fromHsl(i / numberOfBins, 1.0, 0.5, 1.0)
            });
        }

        function getColor(value) {
            for (let bin of bins) {
                if (value >= bin.min && value <= bin.max) {
                    return bin.color;
                }
            }
            return Cesium.Color.WHITE;
        }

        dataSource.entities.values.forEach(entity => {
            const value = entity.properties[property]?.getValue(Cesium.JulianDate.now());
            if (value !== undefined && entity.point) {
                const color = getColor(value);
                entity.point.color = color;
            }
        });

        generateLegend(bins);
    }

    function generateLegend(bins) {
        removeLegend();
        const legendContainer = document.getElementById('legendContainer');

        bins.forEach(bin => {
            const legendItem = document.createElement('div');
            legendItem.style.display = 'flex';
            legendItem.style.alignItems = 'center';

            const colorBox = document.createElement('div');
            colorBox.style.width = '20px';
            colorBox.style.height = '20px';
            colorBox.style.backgroundColor = bin.color.toCssColorString();
            colorBox.style.border = '1px solid #000';
            colorBox.style.marginRight = '10px';

            const label = document.createElement('span');
            label.textContent = `${bin.min.toFixed(2)} - ${bin.max.toFixed(2)}`;

            legendItem.appendChild(colorBox);
            legendItem.appendChild(label);

            legendContainer.appendChild(legendItem);
        });
    }

    function removeLegend() {
        const legendContainer = document.getElementById('legendContainer');
        while (legendContainer.firstChild) {
            legendContainer.removeChild(legendContainer.firstChild);
        }
    }    

    document.querySelectorAll('input[name="property"]').forEach(radio => {
        radio.addEventListener('change', event => {
            updateColors(event.target.value);
        });
    });

    document.getElementById('reset').addEventListener('click', () => {
        document.querySelectorAll('input[name="property"]').forEach(radio => {
            radio.checked = false;
        });
        dataSource.entities.values.forEach(entity => {
            if (entity.point) {
                entity.point.color = Cesium.Color.YELLOW.withAlpha(1);
            }
        });
        removeLegend();
    });

    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');

    function performSearch(searchId) {
        if (!searchId) {
            searchId = searchInput.value.trim();
        }
        if (searchId) {
            const entity = dataSource.entities.getById(searchId);
            if (entity) {
                removeAllEntityPaths();
                showEntityPath(entity);
                highlightedEntities.push(entity);

                const entityPosition = entity.position.getValue(Cesium.JulianDate.now());
                
                const cartographic = Cesium.Cartographic.fromCartesian(entityPosition);
                const lat = cartographic.latitude;
                const lon = cartographic.longitude;
                const alt = cartographic.height;
                const zoomOutFactor = 5;
                const offsetLon = Math.max(100000000, lon * zoomOutFactor);
                const offsetLat = Math.max(100000000, lat * zoomOutFactor);
                const offsetAlt = Math.max(100000000, alt * zoomOutFactor);
                
                const offset = new Cesium.Cartesian3(offsetLon, offsetLat, offsetAlt);
                const destination = Cesium.Cartesian3.add(entityPosition, offset, new Cesium.Cartesian3());

                viewer.camera.flyTo({
                    destination: destination,
                    complete: () => displayInfoBox(entity)
                });
            } else {
                alert('Entity not found/ analysed');
            }
        }
    }

    searchButton.addEventListener('click', () => performSearch());

    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            performSearch();
        }
    });

    const homeButton = viewer.homeButton.viewModel.command;
    homeButton.afterExecute.addEventListener(function() {
        removeAllEntityPaths();
        infoBox.style.display = 'none';
    });

    async function displayTopAndBottomSatellitesByDIT() {
        const entities = dataSource.entities.values;
        const satellitesWithDIT = entities
            .map(entity => ({
                id: entity.id,
                name: entity.name,
                DIT: entity.properties.DIT?.getValue(Cesium.JulianDate.now())
            }))
            .filter(satellite => satellite.DIT !== undefined);

        satellitesWithDIT.sort((a, b) => a.DIT - b.DIT);

        const top5Satellites = satellitesWithDIT.slice(-5).reverse();
        const bottom5Satellites = satellitesWithDIT.slice(0, 10);
        const infoboxContent = `<h3>Highest risk (lowest score) as ranked by L-DIT</h3>${generateSatelliteList(bottom5Satellites)}`;
        const topBottomInfoBox = document.getElementById('topBottomInfoBox');
        topBottomInfoBox.innerHTML = infoboxContent;
        topBottomInfoBox.style.display = 'none';
        
        document.querySelectorAll('.satellite-id').forEach(item => {
            item.addEventListener('click', function() {
                const searchId = this.dataset.id;
                performSearch(searchId);
            });
        });
    }
    
    async function displayStarlinkSatellites() {
    const isAuthenticated = await auth0Client.isAuthenticated();
    const userInfo = isAuthenticated ? await auth0Client.getUser() : null;
    const userName = userInfo ? userInfo.name : null;

    if (!dataSource) {
        console.error('DataSource is not defined.');
        return;
    }

    const entities = dataSource.entities.values;
    const starlinkSatellites = entities
        .filter(entity => entity.name && entity.name.includes('STARLINK'))
        .map(entity => ({
            id: entity.id,
            name: entity.name,
            DIT: entity.properties.DIT?.getValue(Cesium.JulianDate.now())
        }));

    const userInfoContainer = document.getElementById('userInfoContainer');
    let userProfileHTML = `
        <div id="userProfile">
            <p>Hello, ${userName}!</p>
    `;

    if (userName === 'admin@spacex.com') {
        userProfileHTML += `
            ${generateSatelliteList(starlinkSatellites)}
        `;
    }

    userProfileHTML += `</div>`;
    userInfoContainer.innerHTML = userProfileHTML;

    document.querySelectorAll('.satellite-id').forEach(item => {
        item.addEventListener('click', function() {
            const searchId = this.dataset.id;
            performSearch(searchId);
        });
    });
}


    function generateSatelliteList(satellites) {
        return `<ul style="padding-left: 10px; list-style-type: none;">
                    ${satellites.map(satellite => 
                        `<li> DIT <b>${satellite.DIT.toFixed(2)}</b> 
                        [ID: <span class="satellite-id" data-id="${satellite.id}" style="cursor: pointer; color: blue; text-decoration: underline;">
                        ${satellite.id}</span>] ${satellite.name}</li>`).join('')}
                </ul>`;
    }

    const rankingsToggle = document.getElementById('rankingsToggle');
    rankingsToggle.addEventListener('click', () => {
        const topBottomInfoBox = document.getElementById('topBottomInfoBox');
        if (topBottomInfoBox) {
            topBottomInfoBox.style.display = topBottomInfoBox.style.display === 'none' ? 'block' : 'none';
        }
    });
}


function openNav() {
    document.getElementById("sideNav").style.width = "250px";
    document.getElementById("main").style.marginLeft = "250px";
    document.getElementById("openNavBtn").style.display = 'none';
}


function closeNav() {
    document.getElementById("sideNav").style.width = "0";
    document.getElementById("main").style.marginLeft= "0";
    document.getElementById("openNavBtn").style.display = 'none';
}

openNav();
