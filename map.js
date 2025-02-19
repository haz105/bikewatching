// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiaGF6MTA1IiwiYSI6ImNtN2M3dW1pbDBtemcydnE2bTRmeWhnOGkifQ.qI7TkZdK4eny-h82Ah6cdA';

// Initialize the Mapbox map
const map = new mapboxgl.Map({
  container: 'map', 
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});

// Global variables for filtering
let timeFilter = -1;  // -1 means no filtering
let trips = [];       // Will hold full traffic data
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Elect slider and display elements
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

// Helper: Format minutes since midnight to time string (HH:MM AM/PM)
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Update slider display and trigger filtering
function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);
  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'block';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }
  if (typeof window.updateFilteredData === 'function') {
    window.updateFilteredData();
  }
}
timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();  // Initial display

// Helper: Convert a Date object to minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Helper: Filter trips in a ±60 minute window (handle midnight wrap-around)
function filterByMinute(tripsByMinute, minute) {
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Select the SVG element for station markers
const svg = d3.select('#map').select('svg');
let stations = [];  // Will hold station data

// Helper: Convert station coordinates to pixel positions
function getCoords(station) {
  const lon = parseFloat(station.lon);
  const lat = parseFloat(station.lat);
  if (isNaN(lon) || isNaN(lat)) {
    console.warn("Invalid coordinates for station:", station);
    return { cx: -100, cy: -100 };
  }
  const point = new mapboxgl.LngLat(lon, lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

map.on('load', () => {
  // --- Step 2: Adding Bike Lanes ---
  const bikeLaneStyle = {
    'line-color': 'green',
    'line-width': 3,
    'line-opacity': 0.4
  };

  // Boston Bike Lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle
  });

  // Cambridge Bike Lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/resource/cambridge-bike-lanes.geojson'
  });
  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle
  });

  // --- Step 3: Adding Bike Stations ---
  const stationsUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  d3.json(stationsUrl)
    .then(jsonData => {
      console.log('Loaded station JSON:', jsonData);
      stations = jsonData.data.stations;
      console.log('Stations Array:', stations);

      // Create circles for each station
      const circles = svg.selectAll('circle')
        .data(stations)
        .enter()
        .append('circle')
        .attr('pointer-events', 'auto')
        .attr('r', 5)
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8);

      function updatePositions() {
        circles
          .attr('cx', d => getCoords(d).cx)
          .attr('cy', d => getCoords(d).cy);
      }
      updatePositions();
      map.on('move', updatePositions);
      map.on('zoom', updatePositions);
      map.on('resize', updatePositions);
      map.on('moveend', updatePositions);

      // --- Step 4 & 5: Loading Traffic Data and Enabling Filtering ---
      const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
      d3.csv(trafficUrl)
        .then(csvTrips => {
          console.log('Loaded traffic CSV:', csvTrips);
          trips = csvTrips;
          // Convert time strings to Date objects and bucket trips by minute
          for (let trip of trips) {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            const startMin = minutesSinceMidnight(trip.started_at);
            const endMin = minutesSinceMidnight(trip.ended_at);
            departuresByMinute[startMin].push(trip);
            arrivalsByMinute[endMin].push(trip);
          }
          console.log('Trips processed. Example bucket:', departuresByMinute.slice(480,485));

          // Define the filtering function and expose it globally
          function updateFilteredData() {
            let filteredDepartures, filteredArrivals;
            if (timeFilter === -1) {
              filteredDepartures = trips;
              filteredArrivals = trips;
            } else {
              filteredDepartures = filterByMinute(departuresByMinute, timeFilter);
              filteredArrivals = filterByMinute(arrivalsByMinute, timeFilter);
            }
            console.log(`Time filter ${timeFilter}: Departures=${filteredDepartures.length}, Arrivals=${filteredArrivals.length}`);

            // Fallback if no trips are found
            if (filteredDepartures.length === 0 && filteredArrivals.length === 0) {
              console.warn("No trips found in filter window; using unfiltered data.");
              filteredDepartures = trips;
              filteredArrivals = trips;
            }

            // Calculate departures and arrivals per station using d3.rollup
            const departuresMap = d3.rollup(
              filteredDepartures,
              v => v.length,
              d => d.start_station_id
            );
            const arrivalsMap = d3.rollup(
              filteredArrivals,
              v => v.length,
              d => d.end_station_id
            );

            // Create a new array of station objects with updated traffic data
            const filteredStations = stations.map(station => {
              const st = { ...station };
              const id = st.short_name;
              st.departures = departuresMap.get(id) || 0;
              st.arrivals = arrivalsMap.get(id) || 0;
              st.totalTraffic = st.departures + st.arrivals;
              return st;
            });
            console.log('Filtered stations:', filteredStations);

            // Set up a square-root scale for circle radii.
            const maxTraffic = d3.max(filteredStations, d => d.totalTraffic) || 1;
            const radiusScale = d3.scaleSqrt()
              .domain([0, maxTraffic])
              .range(timeFilter === -1 ? [0, 25] : [3, 50]);

            // Create a quantize scale for traffic flow (ratio of departures to total)
            const stationFlow = d3.scaleQuantize()
              .domain([0, 1])
              .range([0, 0.5, 1]);

            // Update circles: adjust radius and set CSS variable for color blending
            circles.data(filteredStations)
              .transition().duration(500)
              .attr('r', d => radiusScale(d.totalTraffic))
              .style("--departure-ratio", d => {
                // Avoid division by zero; if totalTraffic is 0, use 0.
                return stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0);
              });

            // Update tooltips
            circles.selectAll('title').remove();
            circles.append('title')
              .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
          }
          window.updateFilteredData = updateFilteredData;
          updateFilteredData();  // Initial update
        })
        .catch(error => {
          console.error('Error loading traffic CSV:', error);
        });
    })
    .catch(error => {
      console.error('Error loading station JSON:', error);
    });
});
