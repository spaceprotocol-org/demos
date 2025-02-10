document.addEventListener("DOMContentLoaded", async function() {
    const loadingScreen = document.getElementById('loadingScreen');
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
        const searchContainer = document.getElementById('searchContainer');
        searchContainer.style.display = 'block';



        const urlParams = new URLSearchParams(window.location.search);
        const idFromURL = urlParams.get('id');
        if (idFromURL) {
            performSearch(idFromURL);
        }

        dataSource.entities.values.forEach(entity => entity.show = false);

    } catch (error) {
        console.log(error);
    }

    const infoBox = document.getElementById("infoBox");

    // In showCompressedInfo, update infoBox styling so its width fits content and text is smaller.
    function showCompressedInfo(entityData, mousePosition) {
        // Extract the entity id from the passed object or use the id directly.
        const entityId = (typeof entityData === 'object' && entityData.id) ? entityData.id : entityData;
        
        // Retrieve the entity from dataSource.
        const entity = dataSource && dataSource.entities && dataSource.entities.getById
            ? dataSource.entities.getById(entityId)
            : null;
        
        const now = Cesium.JulianDate.now();
        const offset = 10;
    
        // -----
            
        if (entity) {
            const uniqueness = entity.properties.uniqueness?.getValue(now);
            const uniquenessStr = (typeof uniqueness === 'number')
                ? (uniqueness < 0.01 ? uniqueness.toExponential(2) : uniqueness.toFixed(2))
                : "N/A";
            infoBox.innerHTML = `<div style="padding: 5px 10px; white-space: nowrap;">
                    <strong>NORAD ID:</strong> ${entity.id} <br>
                    <strong>Name:</strong> ${entity.name || "N/A"} <br>
                    <strong>Uniqueness:</strong> ${uniquenessStr} <br>
                </div>`;
        } else {
            infoBox.innerHTML = `<div style="padding: 5px 10px; white-space: nowrap;">Entity ID: ${entityId}</div>`;
        }
        
        // Ensure the infoBox resizes to fit its content.
        infoBox.style.display = 'inline-block';
        infoBox.style.position = 'absolute';
        infoBox.style.fontSize = '12px';
        infoBox.style.width = '10%';
        infoBox.style.zIndex = '9999'; // Bring the info box to the front
    
        // Initially position the infoBox to the right and below the cursor.
        infoBox.style.left = (mousePosition.x + offset) + 'px';
        infoBox.style.top = (mousePosition.y + offset) + 'px';
    
        // After rendering, adjust position if the box overflows the viewport.
        const boxRect = infoBox.getBoundingClientRect();
    
        // Adjust horizontal position if overflowing right edge.
        if (boxRect.right > window.innerWidth) {
            infoBox.style.left = (mousePosition.x - boxRect.width - offset) + 'px';
        }
    
        // Adjust vertical position: if the bottom overflows, place above the cursor.
        if (boxRect.bottom > window.innerHeight) {
            infoBox.style.top = (mousePosition.y - boxRect.height - offset) + 'px';
        }
        // Similarly, if the top is off screen, position below the cursor.
        if (boxRect.top < 0) {
            infoBox.style.top = (mousePosition.y + offset) + 'px';
        }
    }

    // Updated hideCompressedInfo to clear and hide the info box.
    function hideCompressedInfo() {
        infoBox.style.display = 'none';
        infoBox.innerHTML = '';
    }

    // Re-enable left-click so that when a satellite is clicked, its orbit is toggled.
    viewer.screenSpaceEventHandler.setInputAction(function onLeftClick(movement) {
        const pickedObject = viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            toggleOrbit(pickedObject.id);
        } else {
            removeAllEntityPaths();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewer.screenSpaceEventHandler.setInputAction(function onMouseMove(movement) {
        const pickedObject = viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(pickedObject) && pickedObject.id) {
            showCompressedInfo(pickedObject.id, movement.endPosition);
        } else {
            hideCompressedInfo();
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    viewer.screenSpaceEventHandler.setInputAction(function onLeftClick(movement) {
        const pickedObject = viewer.scene.pick(movement.position);
        if (Cesium.defined(pickedObject) && Cesium.defined(pickedObject.id)) {
            const entity = pickedObject.id;
            // Use showEntityPath instead of toggleOrbit
            showEntityPath(entity);
            highlightedEntities.push(entity);
        } else {
            infoBox.style.display = 'none';
            removeAllEntityPaths();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);


    // ensure all entities are not shown

    // initialise the model
    document.getElementById('radio-leo').checked = true;
    handleOrbitToggle();
    removeAllEntityPaths();
    
    // Define toggleOrbit to show/hide the orbit path.
    function toggleOrbit(entityId) {
        const entity = dataSource && dataSource.entities && dataSource.entities.getById 
            ? dataSource.entities.getById(entityId)
            : null;
        if (!entity) return;
        
        // If the entity already has a path, toggle its visibility.
        if (entity.path) {
            entity.path.show = !entity.path.show;
        } else {
            // Create a sample orbit path.
            // For demonstration, generate a circular orbit using sampled positions.
            const cp = new Cesium.SampledPositionProperty();
            const start = Cesium.JulianDate.now();
            for (let i = 0; i < 360; i += 10) {
                let time = Cesium.JulianDate.addSeconds(start, i, new Cesium.JulianDate());
                // NOTE: In a real implementation, calculate the orbital position.
                // Here we use the entity's current position.
                let pos = entity.position.getValue(Cesium.JulianDate.now());
                cp.addSample(time, pos);
            }
            
            // Apply the orbit path (this creates a new pathGraphics object).
            entity.path = new Cesium.PathGraphics({
                show: true,
                material: Cesium.Color.YELLOW,
                width: 2
            });
            // Update the entity's position property with the sampled positions.
            entity.position = cp;
        }
    }

    function showEntityPath(entity) {
        if (!entity.path) {
            entity.path = new Cesium.PathGraphics({
                width: 1,
                material: new Cesium.ColorMaterialProperty(
                    entity.point ? entity.point.color : Cesium.Color.WHITE
                )
            });
        }
        if (!viewer.entities.contains(entity)) {
            viewer.entities.add(entity);
        }
    
        entity.show = true;
    }

    function removeEntityPath(entity) {
        if (entity.path) {
            entity.path = undefined;
            viewer.entities.remove(entity);
        }
    }

    function removeAllEntityPaths() {
        dataSource.entities.values.forEach(entity => {
            if (entity.path) {
                entity.path = undefined;    // remove path
                viewer.entities.remove(entity); // remove entity from viewer
            }
        });
        highlightedEntities = [];
    }

    function getOrbitEntities(selectedOrbit){
        const entities = dataSource.entities.values;

        console.log("getOrbitEntities called with selectedOrbit: ", selectedOrbit);

        const orbitEntities = entities.filter(entity => {
            const orbit_class = entity.properties.orbit_class?.getValue();
            console.log("orbit_class: ", orbit_class);
            return orbit_class === selectedOrbit;
        });
        return orbitEntities;
    }

    function getSelectedOrbit(){
        let orbit = "";
        if (document.getElementById('radio-leo').checked) orbit = "LEO";
        if (document.getElementById('radio-meo').checked) orbit = "MEO";
        if (document.getElementById('radio-geo').checked) orbit = "GEO";
        if (document.getElementById('radio-heo').checked) orbit = "HEO";
        console.log("getSelectedOrbit called: ", orbit);
        return orbit;
    }

    function getTopBottomEntities(entities){
        // check that entities is an array:
        if (!Array.isArray(entities) && entities.length === 0) {
            throw new Error('entities must be an array or is empty');
        } else {
            console.log("getTopBottomEntities called, entities is a valid array");
        }

        console.log("number of entities: ", entities.length);
        // sort the entities and get the top and bottom 5
        entities.sort((a, b) => a.properties.rank?.getValue() - b.properties.rank?.getValue());

        const topEntities = entities.slice(0, 5);
        const bottomEntities = entities.slice(-5);

        // sort the bottom entities in ascending order
        bottomEntities.reverse();

        if (topEntities.length !== 5 || bottomEntities.length !== 5) {
            throw new Error('topEntities and bottomEntities must have 5 entities each');
        }

        return [topEntities, bottomEntities];
    }

    // will return the top and bottom 5 entities based on uniqueness rank for the given orbit
    function showUniqueOrbits() {
        
        // get which orbit radio is selected
        const selectedOrbit = getSelectedOrbit();
        // get the entities in the selected orbit
        const entities = getOrbitEntities(selectedOrbit);

        const [topEntities, bottomEntities] = getTopBottomEntities(entities);
        
        // remove all entity paths
        removeAllEntityPaths();

        // display the top and bottom entity orbits
        topEntities.forEach(entity => showEntityPath(entity));
        bottomEntities.forEach(entity => showEntityPath(entity));
    }

    // if there is a change in any of the orbit filter radios
    ['radio-leo', 'radio-meo', 'radio-geo', 'radio-heo'].forEach(id => {
        const radio = document.getElementById(id);
        if (radio) {
            radio.addEventListener('change', function() {
                handleOrbitToggle();
            });
        }
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
                        }            
            else {
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

    function toggleOrbit(entityId) {
        if (!entity) return;
        if (entity.path) {
            removeEntityPath(entity);
        } else {
            showEntityPath(entity);
        }
    }
    
    function generateSatelliteList(satellites) {


        return `<ul style="padding-left: 20px; list-style-type: none;">
                    ${satellites.map(satellite => {
                        const uniquenessStr = satellite.properties.uniqueness?.getValue() < 0.01 
                            ? satellite.properties.uniqueness?.getValue().toExponential(2) 
                            : satellite.properties.uniqueness?.getValue().toFixed(2);
                        return `<li>
                            Score: <b>${uniquenessStr}</b> 
                            (<span class="satellite-id" 
                                data-id="${satellite.id}" 
                                onclick="toggleOrbit('${satellite.id}')"
                                style="cursor: pointer; color: blue; text-decoration: underline;">${satellite.id}</span>)
                            ${satellite.name}
                         </li>`;
                    }).join('')}
                </ul>`;
    }
    
    // After you update the infobox content, attach event listeners:
    function attachOrbitToggleHandlers() {
        const ids = document.querySelectorAll('.satellite-id');
        ids.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const noradId = link.getAttribute('data-id');
                toggleOrbit(noradId);
            });
        });
    }

    // In main.js-1, update displayTopAndBottomSatellitesByUniqueness:
    async function displayUniqueOrbitList() {
        
        const selectedOrbit = getSelectedOrbit();

        // get the top and bottom 5 entities
        const entities = getOrbitEntities(selectedOrbit);
        const [topEntities, bottomEntities] = getTopBottomEntities(entities);

        // check if topEntities and bottomEntities are not empty
        if (topEntities.length !== 0 || bottomEntities.length !== 0) {
            console.log("displayUniqueOrbitList called with topEntities: ", topEntities, " and bottomEntities: ", bottomEntities);
        } else {
            console.log("displayUniqueOrbitList called with empty topEntities and bottomEntities");
        }

        // Build the info box content using generateSatelliteList.
        let infoboxContent = `<h3>5 Most Unique Orbits (${selectedOrbit})</h3>` + generateSatelliteList(topEntities);
        infoboxContent += `<h3>5 Least Unique Orbits (${selectedOrbit})</h3>` + generateSatelliteList(bottomEntities);

        const topBottomInfoBox = document.getElementById('topBottomInfoBox');
        topBottomInfoBox.innerHTML = infoboxContent;
        attachOrbitToggleHandlers();

        // Display the container if toggleUnique is selected.
        topBottomInfoBox.style.display = 'block';
    }

    function handleOrbitToggle() {
        console.log("handleOrbitToggle called");
        showUniqueOrbits();
        displayUniqueOrbitList();
    }

    openNav();
});