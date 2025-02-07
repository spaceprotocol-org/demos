document.addEventListener("DOMContentLoaded", async function() {
    const loadingScreen = document.getElementById('loadingScreen');
    Cesium.Ion.defaultAccessToken = CONFIG.ACCESSTOKEN;
    
    const oauth2Token = Cesium.Ion.defaultAccessToken;
    const baseUrl = 'https://api.cesium.com/v1/assets';
    
    document.getElementById('radio-all').checked = true;
    document.querySelector('input[value="toggleAll"]').checked = true;


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
        // displayTopAndBottomSatellitesByDIT();
        displayTopAndBottomSatellitesByUniqueness();


        const urlParams = new URLSearchParams(window.location.search);
        const idFromURL = urlParams.get('id');
        if (idFromURL) {
            performSearch(idFromURL);
        }

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
    
        // Getting the rank of the given satellite on hover
        let satellites = dataSource.entities.values
            .map(ent => ({
                id: ent.id,
                uniqueness: ent.properties.uniqueness?.getValue(now)
            }))
            .filter(sat => sat.uniqueness !== undefined);
        
        satellites.sort((a, b) => a.uniqueness - b.uniqueness);
        
        const totalSatellites = satellites.length;
        const rankIndex = satellites.findIndex(sat => sat.id === entity.id);
        const rankText = rankIndex !== -1 ? `Rank: ${rankIndex + 1} / ${totalSatellites}` : '';
    
        if (entity) {
            const uniqueness = entity.properties?.uniqueness?.getValue(now);
            const uniquenessStr = (typeof uniqueness === 'number')
                ? (uniqueness < 0.01 ? uniqueness.toExponential(2) : uniqueness.toFixed(2))
                : "N/A";
            infoBox.innerHTML = `<div style="padding: 5px 10px; white-space: nowrap;">
                    <strong>NORAD ID:</strong> ${entity.id} <br>
                    <strong>Name:</strong> ${entity.name || "N/A"} <br>
                    <strong>Uniqueness:</strong> ${uniquenessStr} <br>
                    <strong>Rank:</strong> ${rankText || "N/A"}
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

    function filterByRank10() {
        //just make sure that the toggleUnique radio is actually checked
        const istoggleUnique = document.querySelector('input[value="toggleUnique"]').checked;

        // Gather the selected orbit filters
        let orbitFilters = [];
        if (document.getElementById('radio-all').checked) orbitFilters.push("LEO", "MEO", "GEO", "HEO");
        if (document.getElementById('radio-leo').checked) orbitFilters.push("LEO");
        if (document.getElementById('radio-meo').checked) orbitFilters.push("MEO");
        if (document.getElementById('radio-geo').checked) orbitFilters.push("GEO");
        if (document.getElementById('radio-heo').checked) orbitFilters.push("HEO");
        
        // Filter entities based on orbit filters if any are selected, otherwise use all entities.
        let filteredEntities = dataSource.entities.values;
        if (orbitFilters.length > 0) {
            filteredEntities = filteredEntities.filter(entity => {
                const orbitClass = entity.properties.orbit_class && entity.properties.orbit_class.getValue(viewer.clock.currentTime);
                return orbitClass && orbitFilters.includes(orbitClass);
            });
        }
                
        // Sort the filtered entities by rank (assumes lower rank equals higher uniqueness)
        const sortedEntities = filteredEntities.slice().sort((a, b) => {
            const rankA = parseFloat(a.properties.rank.getValue(viewer.clock.currentTime));
            const rankB = parseFloat(b.properties.rank.getValue(viewer.clock.currentTime));
            return rankA - rankB;
        });
        
        // Get top 5 and bottom 5 from the sorted list.
        const topEntities = sortedEntities.slice(0, 5);
        const bottomEntities = sortedEntities.slice(-5);
        
        // Hide all entities first.
        dataSource.entities.values.forEach(entity => entity.show = false);
        
        // Show top satellites if radio is checked.
        if (istoggleUnique) {
            topEntities.forEach(entity => entity.show = true);
            bottomEntities.forEach(entity => entity.show = true);
            // show their orbits
            topEntities.forEach(entity => showEntityPath(entity));
            bottomEntities.forEach(entity => showEntityPath(entity));

            displayTopAndBottomSatellitesByUniqueness();
        } else {
            topBottomInfoBox.style.display = 'none';
            console.log("filterByRank10: toggleUnique radio is not checked");
        }
        
    }

    function filterOrbitClasses() {

        const all = document.getElementById('radio-all').checked;
        const leo = document.getElementById('radio-leo').checked;
        const meo = document.getElementById('radio-meo').checked;
        const geo = document.getElementById('radio-geo').checked;
        const heo = document.getElementById('radio-heo').checked;

        // handle the case where the toggleAll radio is selected
        const toggleAll = document.querySelector('input[value="toggleAll"]').checked;
        if (toggleAll) {
            removeAllEntityPaths();
            topBottomInfoBox.style.display = 'none';
            if (all) {
                dataSource.entities.values.forEach(entity => {
                    entity.show = true;
                });
            } else {
                dataSource.entities.values.forEach(entity => {
                    const orbitClass = entity.properties.orbit_class && entity.properties.orbit_class.getValue(viewer.clock.currentTime);
                    if (orbitClass && (
                           (leo && orbitClass === "LEO") ||
                           (meo && orbitClass === "MEO") ||
                           (geo && orbitClass === "GEO") ||
                           (heo && orbitClass === "HEO")
                       )) {
                        entity.show = true;
                    } else {
                        entity.show = false;
                        console.log("issues filtering the orbits");
                    }
                });
            }
        } else { // handle the case where the toggleUnique radio is selected
            console.log('filterOrbitClasses: toggleUnique radio is checked');
            filterByRank10();
            
        }  
    }
        
    // Attach event listeners to the display change radios
    document.querySelector('input[value="toggleUnique"]').addEventListener('change', filterByRank10);
    // if the all radio is selected, show all entities for the given orbit class
    document.querySelector('input[value="toggleAll"]').addEventListener('change', filterOrbitClasses);

    // if there is a change in any of the orbit filter radios
    ['radio-all', 'radio-leo', 'radio-meo', 'radio-geo', 'radio-heo'].forEach(id => {
        const radio = document.getElementById(id);
        if (radio) {
            radio.addEventListener('change', function() {
                if (document.querySelector('input[value="toggleUnique"]').checked) {
                    filterByRank10();
                    displayTopAndBottomSatellitesByUniqueness();
                } else {
                    filterOrbitClasses();
                }
            });
        }
    });


    function updateColors(property, numberOfBins = 5) {
        let minValue = Infinity;
        let maxValue = -Infinity;
        let hasValues = false;
    
        dataSource.entities.values.forEach(entity => {
            const value = entity.properties[property]?.getValue(Cesium.JulianDate.now());
            if (value !== undefined) {
                hasValues = true;
                minValue = Math.min(minValue, value);
                maxValue = Math.max(maxValue, value);
            }
        });
    
        if (!hasValues) {
            removeLegend();
            return;
        }
    
        const binSize = (maxValue - minValue) / numberOfBins;
        const bins = [];
        for (let i = 0; i < numberOfBins; i++) {
            let color;
            // Change only the colors for each bin for better contrast against a black background
            switch (i) {
                case 0:
                    // For uniqueness range 0.00 - 0.20: Green
                    color = Cesium.Color.fromCssColorString("#00FF00");
                    break;
                case 1:
                    // For uniqueness range 0.20 - 0.40: Yellow
                    color = Cesium.Color.fromCssColorString("#FFFF00");
                    break;
                case 2:
                    // Mid range: Bright Orange
                    color = Cesium.Color.fromCssColorString("#FF8C00");
                    break;
                case 3:
                    // Next range: Pink
                    color = Cesium.Color.fromCssColorString("#FF69B4");
                    break;
                case 4:
                    // Highest range: Bright Red
                    color = Cesium.Color.fromCssColorString("#FF0000");
                    break;
                default:
                    color = Cesium.Color.WHITE;
            }
            bins.push({
                min: minValue + i * binSize,
                max: minValue + (i + 1) * binSize,
                color: color
            });
        }
    
        // getColor uses the bins to map value to color
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

    updateColors('uniqueness', 5);

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
        const entity = dataSource.entities.getById(entityId);
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
                        const uniquenessStr = satellite.uniqueness < 0.01 
                            ? satellite.uniqueness.toExponential(2) 
                            : satellite.uniqueness.toFixed(2);
                        return `<li>
                            Score: <b>${uniquenessStr}</b> 
                            [ID: <span class="satellite-id" data-id="${satellite.id}" onclick="toggleOrbit('${satellite.id}')" style="cursor: pointer; color: blue; text-decoration: underline;">
                            ${satellite.id}</span>]
                            Rank: <b>${satellite.rank} / ${satellite.total}</b> 
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
    async function displayTopAndBottomSatellitesByUniqueness() {
        console.log('displayTopAndBottomSatellitesByUniqueness called');

        const istoggleUnique = document.querySelector('input[value="toggleUnique"]').checked;

        // Determine the orbit filter based on the selected radio button.
        let orbitFilters = [];
        if (document.getElementById('radio-all').checked) {
            orbitFilters = ["LEO", "MEO", "GEO", "HEO"];
        }
        if (document.getElementById('radio-leo').checked) orbitFilters = ["LEO"];
        if (document.getElementById('radio-meo').checked) orbitFilters = ["MEO"];
        if (document.getElementById('radio-geo').checked) orbitFilters = ["GEO"];
        if (document.getElementById('radio-heo').checked) orbitFilters = ["HEO"];

        const now = Cesium.JulianDate.now();
        const entities = dataSource.entities.values;
        
        // Compute overall ranking info for all satellites with uniqueness.
        let overallSatellites = entities
            .map(ent => ({
                id: ent.id,
                uniqueness: ent.properties.uniqueness?.getValue(now)
            }))
            .filter(sat => sat.uniqueness !== undefined);
        overallSatellites.sort((a, b) => a.uniqueness - b.uniqueness);
        const overallTotalSatellites = overallSatellites.length;
        
        let satellitesWithUniqueness = entities
            .map(entity => ({
                id: entity.id,
                name: entity.name,
                uniqueness: entity.properties.uniqueness?.getValue(now),
                orbitClass: entity.properties.orbit_class?.getValue(now)
            }))
            // Only include satellites that have both a uniqueness and an orbit class.
            .filter(sat => sat.uniqueness !== undefined && sat.orbitClass !== undefined);
        
        // Keep only satellites matching the selected orbit filter.
        if (orbitFilters.length > 0) {
            satellitesWithUniqueness = satellitesWithUniqueness.filter(sat => orbitFilters.includes(sat.orbitClass));
        }
        
        // Sort satellites based on uniqueness (assumes lower uniqueness means more unique).
        satellitesWithUniqueness.sort((a, b) => a.uniqueness - b.uniqueness);
        
        // Get top (most unique) and bottom (least unique) 5 satellites from the filtered list.
        const topSatellites = satellitesWithUniqueness.slice(-5).reverse();
        const bottomSatellites = satellitesWithUniqueness.slice(0, 5);
        
        // Use overall ranking for each satellite.
        topSatellites.forEach(sat => {
            const overallIndex = overallSatellites.findIndex(osat => osat.id === sat.id);
            sat.rank = overallIndex + 1;
            sat.total = overallTotalSatellites;
        });
        bottomSatellites.forEach(sat => {
            const overallIndex = overallSatellites.findIndex(osat => osat.id === sat.id);
            sat.rank = overallIndex + 1;
            sat.total = overallTotalSatellites;
        });

        let displayOrbitText = document.getElementById('radio-all').checked ? "ALL" : orbitFilters.join(', ');

        // Build the info box content using generateSatelliteList.
        let infoboxContent = `<h3>5 Most Unique Orbits (${displayOrbitText})</h3>` + generateSatelliteList(topSatellites);
        infoboxContent += `<h3>5 Least Unique Orbits (${displayOrbitText})</h3>` + generateSatelliteList(bottomSatellites);

        const topBottomInfoBox = document.getElementById('topBottomInfoBox');
        topBottomInfoBox.innerHTML = infoboxContent;
        attachOrbitToggleHandlers();

        // Display the container if toggleUnique is selected.
        topBottomInfoBox.style.display = istoggleUnique ? 'block' : 'none';

        if (istoggleUnique) {
            orbitsOn = true;
            removeAllEntityPaths();
            dataSource.entities.values.forEach(entity => {
                if (entity.show) {
                    showEntityPath(entity);
                }
            });
        }
    }



    const rankingsToggle = document.getElementById('rankingsToggle');
    rankingsToggle.addEventListener('click', () => {
        const topBottomInfoBox = document.getElementById('topBottomInfoBox');
        if (topBottomInfoBox) {
            topBottomInfoBox.style.display = topBottomInfoBox.style.display === 'none' ? 'block' : 'none';
        }
    });

    openNav();
});