document.addEventListener("DOMContentLoaded", async function() {
    const loadingScreen = document.getElementById('loadingScreen');
    Cesium.Ion.defaultAccessToken = CONFIG.ACCESSTOKEN;
    
    const oauth2Token = Cesium.Ion.defaultAccessToken;
    const baseUrl = 'https://api.cesium.com/v1/assets';
    
    // ensure that the filtering checkboxes are off by default
    const topCheckbox = document.querySelector('input[value="top"]');
    const bottomCheckbox = document.querySelector('input[value="bottom"]');
    if (topCheckbox) topCheckbox.checked = false;
    if (bottomCheckbox) bottomCheckbox.checked = false;


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
        const now = Cesium.JulianDate.now();
        const uniqueness = entity.properties.uniqueness?.getValue(now);
        const rank = entity.properties.rank?.getValue(now);
        
        infoBox.style.display = 'block';
        infoBox.innerHTML = `<div class="info-content">
                                 <strong>NORAD CAT ID:</strong> <span>${entity.id}</span>
                                 <strong>NAME:</strong> <span>${entity.name}</span>
                                 <strong>Uniqueness:</strong> <span>${uniqueness}</span>
                                 <strong>Rank:</strong> <span>${rank}</span>
                             </div>`;
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

    function filterByRank10() {
        const showTop = document.querySelector('input[value="top"]').checked;
        const showBottom = document.querySelector('input[value="bottom"]').checked;
    
        // If neither checkbox is selected, show all entities
        if (!showTop && !showBottom) {
            dataSource.entities.values.forEach(entity => {
                entity.show = true;
            });
        } else {
            // Filter entities that have a valid rank property and sort them in ascending order (best rank first)
            const sortedEntities = dataSource.entities.values
                .filter(entity => {
                    const rankValue = entity.properties.rank?.getValue(Cesium.JulianDate.now());
                    return typeof rankValue === 'number';
                })
                .sort((a, b) => {
                    return a.properties.rank.getValue(Cesium.JulianDate.now()) - b.properties.rank.getValue(Cesium.JulianDate.now());
                });
    
            // Get the top 5 (lowest rank values) and bottom 5 (highest rank values), adjust as needed
            const topEntities = new Set(sortedEntities.slice(0, 5).map(entity => entity.id));
            const bottomEntities = new Set(sortedEntities.slice(-5).map(entity => entity.id));
    
            // Update entity visibility based on which checkboxes are selected.
            dataSource.entities.values.forEach(entity => {
                if ((showTop && topEntities.has(entity.id)) || (showBottom && bottomEntities.has(entity.id))) {
                    entity.show = true;
                } else {
                    entity.show = false;
                }
            });
        }
        
        // If orbits are currently toggled on, update the orbit paths for the entities now visible.
        if (orbitsOn) {
            removeAllEntityPaths();
            dataSource.entities.values.forEach(entity => {
                if (entity.show) {
                    showEntityPath(entity);
                    highlightedEntities.push(entity);
                }
            });
        }
    }
    
    // Attach filterByRank10 to checkbox changes
    document.querySelector('input[value="top"]').addEventListener('change', filterByRank10);
    document.querySelector('input[value="bottom"]').addEventListener('change', filterByRank10);

    let orbitsOn = false;
    const toggleOrbitsButton = document.getElementById('toggleOrbits');

    toggleOrbitsButton.addEventListener('click', () => {
        orbitsOn = !orbitsOn;
        if (orbitsOn) {
            // For all currently visible entities, add orbit paths.
            dataSource.entities.values.forEach(entity => {
                if (entity.show) {
                    showEntityPath(entity);
                    highlightedEntities.push(entity);
                }
            });
            toggleOrbitsButton.innerText = 'Hide Orbits';
        } else {
            removeAllEntityPaths();
            toggleOrbitsButton.innerText = 'Show Orbits';
        }
    });
    
    // toggleOrbitsButton.addEventListener('mouseenter', () => {
    //     const topCheckbox = document.querySelector('input[value="top"]');
    //     const bottomCheckbox = document.querySelector('input[value="bottom"]');
    //     if (!topCheckbox.checked && !bottomCheckbox.checked) {
    //         toggleOrbitsButton.setAttribute('title', 'Computationally intensive');
    //     } else {
    //         toggleOrbitsButton.removeAttribute('title');
    //     }
    // });
    
    // toggleOrbitsButton.addEventListener('mouseleave', () => {
    //     toggleOrbitsButton.removeAttribute('title');
    // });

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
    // document.querySelector('input[value="uniqueness"]').checked = true;

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
        // <div><h3>Highest ranked by L-DIT</h3>${generateSatelliteList(top5Satellites)}</div>
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

    if (topCheckbox) {
        topCheckbox.addEventListener('change', displayTopAndBottomSatellitesByUniqueness);
    }
    if (bottomCheckbox) {
        bottomCheckbox.addEventListener('change', displayTopAndBottomSatellitesByUniqueness);
    }

    async function displayTopAndBottomSatellitesByUniqueness() {
        const entities = dataSource.entities.values;
        const satellitesWithUniqueness = entities
            .map(entity => ({
                id: entity.id,
                name: entity.name,
                uniqueness: entity.properties.uniqueness?.getValue(Cesium.JulianDate.now())
            }))
            .filter(satellite => satellite.uniqueness !== undefined);
    
        satellitesWithUniqueness.sort((a, b) => a.uniqueness - b.uniqueness);
    
        const top10Satellites = satellitesWithUniqueness.slice(-5).reverse();
        const bottom10Satellites = satellitesWithUniqueness.slice(0, 5);
    
        let infoboxContent = '';
        
        // Show top 5 if 'top' checkbox is checked
        if (topCheckbox.checked) {
            const contentTop = `<h3>5 Most Unique Satellites</h3>${generateSatelliteList(top10Satellites)}`;
            infoboxContent += contentTop;
        }
        // Show bottom 5 if 'bottom' checkbox is checked
        if (bottomCheckbox.checked) {
            const contentBottom = `<h3>5 Least Unique Satellites</h3>${generateSatelliteList(bottom10Satellites)}`;
            infoboxContent += contentBottom;
        }
        
        const topBottomInfoBox = document.getElementById('topBottomInfoBox');
        topBottomInfoBox.innerHTML = infoboxContent;
        // Display the container if any checkbox is selected; otherwise hide it.
        topBottomInfoBox.style.display = (topCheckbox.checked || bottomCheckbox.checked) ? 'block' : 'none';
    }

    function generateSatelliteList(satellites) {
        return `<ul style="padding-left: 20px; list-style-type: none;">
                    ${satellites.map(satellite => 
                        `<li> Score <b>${satellite.uniqueness.toFixed(2)}</b> 
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

    openNav();
});