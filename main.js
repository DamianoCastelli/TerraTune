import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { CONTINENT_COUNTRY_MAP, LANG_MAP, COUNTRY_MAIN_TZ } from './helper_dictionaries';

class GlobeRadio {
  constructor() {
    this.init();
    this.setupEventListeners();
    this.animate();
    this.stations = new Map();
    this.globeScale = 2;
    this.targetScale = 2;
    this.isZooming = false;
    this.favorites = new Set(JSON.parse(localStorage.getItem('favorites') || '[]'));
    this.history = JSON.parse(localStorage.getItem('history') || '[]');
    this.loadZenoStations();
    this.hoveredMarker = null;
    this.infoPopup = null;
    this.cityTzCache = {};
    this.audio = new Audio();
    this.isPlaying = false;
    this.currentLanguage = localStorage.getItem('lang') || 'zh';
  }

  init() {
    // Create scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Create camera
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.z = 6;

    // Create renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000);
    const globeContainer = document.getElementById('globe-container');
    console.log('globe-container:', globeContainer);
    this.renderer.domElement && console.log('renderer dom:', this.renderer.domElement);
    globeContainer && globeContainer.appendChild(this.renderer.domElement);

    // Create globe
    const geometry = new THREE.SphereGeometry(2, 64, 64);
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg');
    const material = new THREE.MeshPhongMaterial({
      map: earthTexture,
      shininess: 5
    });
    this.globe = new THREE.Mesh(geometry, material);
    this.scene.add(this.globe);

    // Restore original lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 3, 5);
    this.scene.add(directionalLight);

    // Add controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;

    // Create raycaster for click detection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Create loading indicator
    this.createLoadingIndicator();

    // Create info popup
    this.createInfoPopup();
  }

  createLoadingIndicator() {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-indicator';
    loadingDiv.style.position = 'fixed';
    loadingDiv.style.top = '20px';
    loadingDiv.style.left = '50%';
    loadingDiv.style.transform = 'translateX(-50%)';
    loadingDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    loadingDiv.style.color = 'white';
    loadingDiv.style.padding = '10px 20px';
    loadingDiv.style.borderRadius = '5px';
    loadingDiv.style.zIndex = '1000';
    loadingDiv.textContent = 'Loading radio data...';
    document.body.appendChild(loadingDiv);
  }

  createInfoPopup() {
    const popup = document.createElement('div');
    popup.id = 'station-info-popup';
    popup.style.position = 'fixed';
    popup.style.pointerEvents = 'none';
    popup.style.background = 'rgba(0,0,0,0.85)';
    popup.style.color = '#fff';
    popup.style.padding = '8px 14px';
    popup.style.borderRadius = '6px';
    popup.style.fontSize = '14px';
    popup.style.zIndex = '9999';
    popup.style.display = 'none';
    document.body.appendChild(popup);
    this.infoPopup = popup;
  }

  async loadZenoStations() {
    try {
      // Load local stations.json
      const response = await fetch('stations.json');
      const stationsData = await response.json();

      stationsData.forEach(station => {
        const key = `${station.latitude},${station.longitude}`;
        if (!this.stations.has(key)) {
          this.stations.set(key, []);
        }
        this.stations.get(key).push(station);
      });

      // Add stations markers on the globe
      this.addStationMarkers();

      // Remove loading indicator
      const loadingIndicator = document.getElementById('loading-indicator');
      if (loadingIndicator) {
        loadingIndicator.remove();
      }

      // Create station list
      // this.createStationList(); not defined (?)
    } catch (error) {
      console.error('Error loading stations:', error);
      const loadingIndicator = document.getElementById('loading-indicator');
      if (loadingIndicator) {
        loadingIndicator.textContent = 'Loading stations data failed';
        loadingIndicator.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
      }
    }
  }

  addStationMarkers() {
    const markerGeometry = new THREE.SphereGeometry(0.008, 8, 8); // Marker on globe surface
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const markerRadius = this.globeScale; // Marker on globe surface
    const markerTipRadius = this.globeScale * 1.025; // Beam end point
    const beamRadius = 0.002; // Thin beam
    const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.7 });

    this.markerObjects = [];
    this.beamObjects = [];

    this.stations.forEach((stations, coords) => {
      stations.forEach(station => {
        const [lat, lon] = [station.latitude, station.longitude];
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);

        // Marker on globe surface
        const marker = new THREE.Mesh(markerGeometry, markerMaterial.clone());
        marker.position.x = -markerRadius * Math.sin(phi) * Math.cos(theta);
        marker.position.y = markerRadius * Math.cos(phi);
        marker.position.z = markerRadius * Math.sin(phi) * Math.sin(theta);
        marker.userData.station = station;
        marker.userData.originalColor = 0xff0000;
        this.scene.add(marker);
        this.markerObjects.push(marker);

        // Beam
        const start = new THREE.Vector3(
          -markerRadius * Math.sin(phi) * Math.cos(theta),
          markerRadius * Math.cos(phi),
          markerRadius * Math.sin(phi) * Math.sin(theta)
        );
        const end = new THREE.Vector3(
          -markerTipRadius * Math.sin(phi) * Math.cos(theta),
          markerTipRadius * Math.cos(phi),
          markerTipRadius * Math.sin(phi) * Math.sin(theta)
        );
        const beamHeight = start.distanceTo(end);
        // CylinderGeometry default y-axis is height direction
        const beamGeometry = new THREE.CylinderGeometry(beamRadius, beamRadius, beamHeight, 8);
        const beam = new THREE.Mesh(beamGeometry, beamMaterial.clone());
        // Set beam center point in the middle of start and end
        beam.position.copy(start).add(end).multiplyScalar(0.5);
        // Rotate beam to point towards end-start
        beam.lookAt(end);
        beam.rotateX(Math.PI / 2); // Rotate beam to align with start->end direction
        beam.userData.marker = marker; // Let beam know which marker it corresponds to
        this.scene.add(beam);
        this.beamObjects.push({ beam, lat, lon });
      });
    });

    if (!this._markerClickListenerAdded) {
      this.renderer.domElement.addEventListener('click', (event) => this.onMarkerClick(event));
      this.renderer.domElement.addEventListener('mousemove', (event) => this.onMarkerHover(event));
      this._markerClickListenerAdded = true;
    }
  }

  onMarkerHover(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    let minDist = Infinity;
    let closestMarker = null;
    // Iterate through all markers to find the closest to mouse
    this.markerObjects.forEach(marker => {
      // Project 3D coordinates to screen
      const pos = marker.position.clone().project(this.camera);
      const screenX = (pos.x + 1) / 2 * rect.width;
      const screenY = (-pos.y + 1) / 2 * rect.height;
      const dist = Math.sqrt((screenX - mouseX) ** 2 + (screenY - mouseY) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestMarker = marker;
      }
    });
    // Threshold (pixels)
    const threshold = 10;
    // Reset all first
    this.markerObjects.forEach(marker => {
      marker.material.color.setHex(marker.userData.originalColor);
    });
    this.hoveredMarker = null;
    if (closestMarker && minDist < threshold) {
      closestMarker.material.color.setHex(0xffff00);
      this.hoveredMarker = closestMarker;
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.renderer.domElement.style.cursor = 'default';
    }
  }

  onMarkerClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(mouse, this.camera);

    // Check interaction with all markers
    const intersects = this.raycaster.intersectObjects(this.markerObjects);
    if (intersects.length > 0) {
      const marker = intersects[0].object;
      const station = marker.userData.station;
      if (station) {
        this.playStation(station);
      }
    }
  }

  setupEventListeners() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.getElementById('play-pause').addEventListener('click', () => {
      this.togglePlay();
    });
    document.getElementById('volume').addEventListener('input', (e) => {
      this.audio.volume = e.target.value / 100;
    });
    // Favorite button
    document.getElementById('fav-btn').addEventListener('click', () => {
      if (!this.currentStation) return;
      this.toggleFavorite(this.currentStation);
      this.updateFavBtn(this.currentStation);
    });
  }

  toggleFavorite(station) {
    console.log('toggleFavorite', station);
    if (!station || !station.stream_url) return;
    if (this.favorites.has(station.stream_url)) {
      this.favorites.delete(station.stream_url);
    } else {
      this.favorites.add(station.stream_url);
    }
    localStorage.setItem('favorites', JSON.stringify([...this.favorites]));
    this.updateFavBtn(station);
    // If current Tab is favorites, refresh favorites list
    const activeTab = document.querySelector('#filter-list-tabs .sidebar-tab.active');
    if (activeTab && activeTab.dataset.tab === 'fav') {
      const favs = this.markerObjects.filter(m => this.favorites.has(m.userData.station.stream_url)).map(m => ({ station: m.userData.station, marker: m }));
      updateStationListSidebar(this, favs, 'fav');
    }
  }

  playStation(station) {
    this.currentStation = station;
    console.log('playStation', station);
    // Show player interface immediately
    document.getElementById('station-name').textContent = station.name;
    document.getElementById('station-location').textContent = `${station.country} - ${station.city}`;
    document.getElementById('radio-player').classList.remove('hidden');
    // Status prompt
    document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].loading;
    // Toggle play/pause icon
    this.setPlayPauseIcon(false);
    // Stop current playback
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
    }
    // Only change src, don't create new Audio
    this.audio.src = station.stream_url;
    // Add to history
    this.addToHistory(station);
    // Set loading timeout
    const loadTimeout = setTimeout(() => {
      if (!this.isPlaying) {
        document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].timeout;
        this.setPlayPauseIcon(false);
      }
    }, 5000);
    // Try to play
    this.audio.play()
      .then(() => {
        clearTimeout(loadTimeout);
        console.log('Playback started successfully');
        this.isPlaying = true;
        document.getElementById('player-status').textContent = '';
        this.setPlayPauseIcon(true);
        // Update favorite button status
        this.updateFavBtn(station);
        updatePlayerLocalTime(station);
      })
      .catch(error => {
        clearTimeout(loadTimeout);
        console.error('Playback failed:', error);
        document.getElementById('player-status').textContent = LANG_MAP[this.currentLanguage].failed;
        this.setPlayPauseIcon(false);
      });
  }

  addToHistory(station) {
    this.history = this.history.filter(s => s.stream_url !== station.stream_url);
    this.history.unshift(station);
    if (this.history.length > 50) {
      this.history.pop();
    }
    localStorage.setItem('history', JSON.stringify(this.history));
  }

  togglePlay() {
    if (this.isPlaying) {
      this.audio.pause();
      this.setPlayPauseIcon(false);
    } else {
      this.audio.play();
      this.setPlayPauseIcon(true);
    }
    this.isPlaying = !this.isPlaying;
  }

  setPlayPauseIcon(isPlaying) {
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    if (isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'inline';
    } else {
      playIcon.style.display = 'inline';
      pauseIcon.style.display = 'none';
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    // Smooth zoom animation
    if (this.isZooming) {
      const scaleDiff = this.targetScale - this.globeScale;
      if (Math.abs(scaleDiff) > 0.01) {
        this.globeScale += scaleDiff * 0.1; // Smooth transition
        this.globe.scale.set(this.globeScale, this.globeScale, this.globeScale);
        this.updateMarkerPositions();
      } else {
        this.globeScale = this.targetScale;
        this.globe.scale.set(this.globeScale, this.globeScale, this.globeScale);
        this.updateMarkerPositions();
        this.isZooming = false;
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  updateMarkerPositions() {
    if (!this.markerObjects) return;
    const markerRadius = this.globeScale;
    const markerTipRadius = this.globeScale * 1.025;
    this.markerObjects.forEach((marker, i) => {
      const station = marker.userData.station;
      if (!station) return;
      const lat = station.latitude;
      const lon = station.longitude;
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lon + 180) * (Math.PI / 180);
      marker.position.x = -markerRadius * Math.sin(phi) * Math.cos(theta);
      marker.position.y = markerRadius * Math.cos(phi);
      marker.position.z = markerRadius * Math.sin(phi) * Math.sin(theta);
      // Update beam
      if (this.beamObjects && this.beamObjects[i]) {
        const beamObj = this.beamObjects[i];
        const start = new THREE.Vector3(
          -markerRadius * Math.sin(phi) * Math.cos(theta),
          markerRadius * Math.cos(phi),
          markerRadius * Math.sin(phi) * Math.sin(theta)
        );
        const end = new THREE.Vector3(
          -markerTipRadius * Math.sin(phi) * Math.cos(theta),
          markerTipRadius * Math.cos(phi),
          markerTipRadius * Math.sin(phi) * Math.sin(theta)
        );
        const beamHeight = start.distanceTo(end);
        beamObj.beam.geometry.dispose();
        beamObj.beam.geometry = new THREE.CylinderGeometry(0.002, 0.002, beamHeight, 8);
        beamObj.beam.position.copy(start).add(end).multiplyScalar(0.5);
        beamObj.beam.lookAt(end);
        beamObj.beam.rotation.x += Math.PI / 2;
      }
    });
  }

  updateFavBtn(station) {
    const favBtn = document.getElementById('fav-btn');
    console.log('updateFavBtn', station, this.favorites);
    if (!station || !station.stream_url) {
      favBtn.classList.remove('faved');
      favBtn.title = LANG_MAP[this.currentLanguage].fav;
      return;
    }
    if (this.favorites.has(station.stream_url)) {
      favBtn.classList.add('faved');
      favBtn.title = LANG_MAP[this.currentLanguage].fav;
    } else {
      favBtn.classList.remove('faved');
      favBtn.title = LANG_MAP[this.currentLanguage].fav;
    }
  }

  updateStationTime(station) {
    const timeElement = document.getElementById('station-time');
    if (!timeElement) return;

    if (!station.timezone) {
      timeElement.textContent = this.currentLanguage === 'zh' ? 'Unknown' :
        this.currentLanguage === 'en' ? 'Unknown' :
          'Sconosciuto';
      return;
    }

    try {
      const time = new Date().toLocaleTimeString('en-US', {
        timeZone: station.timezone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      });
      timeElement.textContent = time;
    } catch (error) {
      timeElement.textContent = this.currentLanguage === 'zh' ? 'Unknown' :
        this.currentLanguage === 'en' ? 'Unknown' :
          'Sconosciuto';
    }
  }

  // Play previous station
  playPreviousStation() {
    if (this.history.length > 1) {
      // Get previous station (skip current one being played)
      const previousStation = this.history[1];
      if (previousStation) {
        this.playStation(previousStation);
      }
    }
  }

  // Play random station
  playRandomStation() {
    if (!this.markerObjects || this.markerObjects.length === 0) return;

    // Get all available stations
    const availableStations = this.markerObjects
      .map(marker => marker.userData.station)
      .filter(station => station.stream_url !== this.currentStation?.stream_url);

    if (availableStations.length === 0) return;

    // Randomly select a station
    const randomIndex = Math.floor(Math.random() * availableStations.length);
    this.playStation(availableStations[randomIndex]);
  }

  // Degrees to radians
  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }
}

// --- In GlobeRadio constructor, register instance ---
const _oldGlobeRadio = GlobeRadio;
GlobeRadio = function (...args) {
  const inst = new _oldGlobeRadio(...args);
  window.GlobeRadioInstance = inst;
  return inst;
};

// --- Station list sidebar logic ---
function updateStationListSidebar(globeRadio, filtered, tab) {
  const sidebar = document.getElementById('station-list-sidebar');
  const list = document.getElementById('station-list');
  const closeBtn = document.getElementById('station-list-close');
  const backBtn = document.getElementById('station-list-back');
  const tabs = document.querySelectorAll('#station-list-tabs .sidebar-tab');
  const searchInput = document.getElementById('station-list-search');
  // Back button
  backBtn.onclick = () => {
    // Reset country selection, keep continent selection
    document.getElementById('country-select').value = '';
    // Only link country dropdown, don't show station list
    // document.getElementById('country-select').dispatchEvent(new Event('change'));
    // Tab switch back to all
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0].classList.add('active');
    // Search box clear
    if (searchInput) searchInput.value = '';
    globeRadio.filterStationsByRegion('', '');
    updateStationListSidebar(globeRadio, null, 'all');
  };
  // Tab switch
  tabs.forEach(tabBtn => {
    tabBtn.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabBtn.classList.add('active');
      searchInput.value = '';
      if (tabBtn.dataset.tab === 'all') {
        updateStationListSidebar(globeRadio, null, 'all');
      } else if (tabBtn.dataset.tab === 'fav') {
        const favs = globeRadio.markerObjects.filter(m => globeRadio.favorites.has(m.userData.station.stream_url)).map(m => ({ station: m.userData.station, marker: m }));
        updateStationListSidebar(globeRadio, favs, 'fav');
      } else if (tabBtn.dataset.tab === 'history') {
        const his = globeRadio.history.map(s => {
          const marker = globeRadio.markerObjects.find(m => m.userData.station.stream_url === s.stream_url);
          return marker ? { station: s, marker } : null;
        }).filter(Boolean);
        updateStationListSidebar(globeRadio, his, 'history');
      }
    };
  });
  // Search functionality
  if (!searchInput._listenerAdded) {
    searchInput.addEventListener('input', function () {
      const keyword = this.value.trim().toLowerCase();
      let stations = filtered;
      if (!filtered) {
        stations = globeRadio.markerObjects.map(marker => ({ station: marker.userData.station, marker }));
      }
      if (keyword) {
        stations = stations.filter(({ station }) => {
          return (
            (station.name && station.name.toLowerCase().includes(keyword)) ||
            (station.country && station.country.toLowerCase().includes(keyword)) ||
            (station.city && station.city.toLowerCase().includes(keyword))
          );
        });
      }
      renderStationList(stations, globeRadio, tab);
    });
    searchInput._listenerAdded = true;
  }
  // Fill list
  let stations = filtered;
  if (!filtered) {
    stations = globeRadio.markerObjects.map(marker => ({ station: marker.userData.station, marker }));
  }
  renderStationList(stations, globeRadio, tab);
  sidebar.classList.remove('hidden');
}

function renderStationList(stations, globeRadio, tab) {
  const list = document.getElementById('filter-list');
  list.innerHTML = '';
  if (stations.length === 0) {
    list.innerHTML = `<li style=\"color:#aaa;\">${LANG_MAP[currentLang].noStation}</li>`;
  } else {
    stations.forEach(({ station, marker }, idx) => {
      const li = document.createElement('li');
      // Main information
      const mainDiv = document.createElement('div');
      mainDiv.className = 'station-main';
      mainDiv.innerHTML = `<b>${station.name}</b><span class="station-country">${station.country}${station.city ? ' - ' + station.city : ''}</span>`;
      li.appendChild(mainDiv);
      // Right operation area
      const opsDiv = document.createElement('div');
      opsDiv.className = 'station-ops';
      // Homepage link
      if (station.homepage) {
        const home = document.createElement('a');
        home.href = station.homepage;
        home.target = '_blank';
        home.textContent = LANG_MAP[currentLang].homepage;
        home.style.color = '#4FC3F7';
        home.style.fontSize = '14px';
        home.onclick = e => e.stopPropagation();
        opsDiv.appendChild(home);
      }
      // Favorite star
      const star = document.createElement('span');
      star.className = 'fav-star' + (globeRadio.favorites.has(station.stream_url) ? ' faved' : '');
      star.textContent = '★';
      star.title = globeRadio.favorites.has(station.stream_url) ? 'Remove favorite' : 'Add favorite';
      star.onclick = (e) => {
        e.stopPropagation();
        globeRadio.toggleFavorite(station);
        if (tab === 'fav') {
          const favs = globeRadio.markerObjects.filter(m => globeRadio.favorites.has(m.userData.station.stream_url)).map(m => ({ station: m.userData.station, marker: m }));
          renderStationList(favs, globeRadio, tab);
        } else {
          renderStationList(stations, globeRadio, tab);
        }
      };
      opsDiv.appendChild(star);
      // Local time
      const timeSpan = document.createElement('span');
      timeSpan.className = 'station-localtime';
      (async () => {
        let localStr = '';
        const tz = await getTimezoneByCityCountry(station.city, station.country);
        if (tz) {
          const now = new Date();
          localStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
        }
        timeSpan.textContent = localStr ? `🕒 ${localStr}` : '';
      })();
      timeSpan.style.color = '#FFD700';
      opsDiv.appendChild(timeSpan);
      li.appendChild(opsDiv);
      li.onclick = (e) => {
        if (e.target === star) return;
        globeRadio.markerObjects.forEach(m => m.material.color.setHex(m.userData.originalColor));
        marker.material.color.setHex(0xffff00);
        globeRadio.hoveredMarker = marker;
        globeRadio.playStation(station);
      };
      list.appendChild(li);
    });
  }
}

let currentLang = localStorage.getItem('lang') || 'zh';

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('lang', lang);
  // Switch button highlight
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // Station sidebar tabs
  const tabs = document.querySelectorAll('#station-list-tabs .sidebar-tab');
  tabs[0].textContent = LANG_MAP[lang].all;
  tabs[1].textContent = LANG_MAP[lang].fav;
  tabs[2].textContent = LANG_MAP[lang].history;
  tabs[3].textContent = LANG_MAP[lang].similar;

  // List header
  document.getElementById('filter-list-title').textContent = LANG_MAP[lang].list;
  // Station filter button
  document.getElementById('filter-toggle').innerHTML = `📜 ${LANG_MAP[lang].filterStation}`;
  // Station sidebar toggle button
  document.getElementById('station-toggle').innerHTML = `📻 ${LANG_MAP[lang].browseStation}`;
  // Filter sidebar title
  document.getElementById('filter-list-title').innerHTML = LANG_MAP[lang].filter;
  // Station sidebar title
  document.getElementById('station-list-title').innerHTML = LANG_MAP[lang].list;
  // Account dropdown button
  if (localStorage.userSession) {
    document.getElementById('login-toggle').innerHTML = `🧑 ${LANG_MAP[lang].user}: ${JSON.parse(localStorage.userSession).username}`;
  } else {
    document.getElementById('login-toggle').innerHTML = `🧑 ${LANG_MAP[lang].login}`;
  }

  // Player - Only show "Select a station" when no station is playing
  if (!window.GlobeRadioInstance?.currentStation) {
    document.getElementById('station-name').textContent = LANG_MAP[lang].select;
    document.getElementById('station-location').textContent = '';
    document.getElementById('player-status').textContent = '';
    // Reset play/pause icon to play
    if (typeof GlobeRadioInstance?.setPlayPauseIcon === 'function') {
      GlobeRadioInstance.setPlayPauseIcon(false);
    }
  } else {
    // If there is a station playing, update time display
    updatePlayerLocalTime(window.GlobeRadioInstance.currentStation);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.onclick = () => setLang(btn.dataset.lang);
  });
  setLang(currentLang);
});




// Initialize application //
new GlobeRadio();
window.addEventListener("DOMContentLoaded", () => {
  new AuthManager();
  new FilterManager();
  new StationManager();
  new TimeManager();
});

const cityTzCache = {};

// class to handle timezone stuff
class TimeManager {
  #cityTzCache = {};
  #allTimezones = [];
  #timeElement;
  #currentLang;

  constructor() {
    this.#timeElement = document.getElementById('station-localtime');
    this.#currentLang = localStorage.getItem('lang') || 'zh';
    this._loadTimezones();
  }

  async _loadTimezones() {
    try {
      const response = await fetch('https://worldtimeapi.org/api/timezone');
      if (!response.ok) {
        console.error("Failed to fetch timezone list from API.");
      }
      this.#allTimezones = await resp.json();
      console.log("Timezone list loaded and cached successfully.");
    } catch (e) {
      console.error("Error fetching timezone list:", e);
    }
  }

  getTimezoneByCityCountry(city, country) {
    const key = `${city || ''}|${country || ''}`.toLowerCase();
    if (this.#cityTzCache[key]) {
      return this.#cityTzCache[key];
    }

    const cityNorm = city ? city.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '') : '';
    const countryNorm = country ? country.toLowerCase().replace(/\s+/g, '').replace(/[^a-z]/g, '') : '';
    let zone = null;

    if (this.#allTimezones.length > 0) {
      const zones = this.#allTimezones;
      // 1. Try various city name variations
      if (cityNorm) {
        zone = zones.find(z => z.toLowerCase().replace(/[_\s-]/g, '').includes(cityNorm));
        if (!zone) zone = zones.find(z => z.toLowerCase().includes(cityNorm));
      }
      // 2. If no city match, use country name
      if (!zone && countryNorm) {
        zone = zones.find(z => z.toLowerCase().replace(/[_\s-]/g, '').includes(countryNorm));
        if (!zone) zone = zones.find(z => z.toLowerCase().includes(countryNorm));
      }
    }
    if (!zone && countryNorm && COUNTRY_MAIN_TZ[countryNorm]?.timezone) {
      zone = COUNTRY_MAIN_TZ[countryNorm].timezone;
    }
    if (zone) {
      this.#cityTzCache[key] = zone;
    }
    return zone || null;
  }

  updatePlayerLocalTime(station) {
    if (!this.#timeElement) return;
    if (!station) {
      this.#timeElement.textContent = '🕒 ' + (LANG_MAP[this.#currentLang]?.unknown || 'Unknown');
      return;
    }
    const tz = this.getTimezoneByCityCountry(station.city, station.country);
    if (tz) {
      const now = new Date();
      const localStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
      this.#timeElement.textContent = `🕒 ${localStr}`;
    } else {
      this.#timeElement.textContent = '🕒 ' + (LANG_MAP[this.#currentLang]?.unknown || 'Unknown');
    }
  }
}

// class to handle authentication
class AuthManager {

  #loginForm;
  #registerForm;
  #logoutButton;
  #loginToggle;
  #loginDropdown;
  #backendUrl = "https://terratune-backend.onrender.com";

  constructor() {
    this.#cacheDOMElements();
    this.#setupEventListeners();
    this.#sessionValidation();
  }

  // retrieves the dom elements
  #cacheDOMElements() {
    this.#loginForm = document.getElementById('login-form');
    this.#registerForm = document.getElementById('register-form');
    this.#logoutButton = document.getElementById('logout-button');
    this.#loginToggle = document.getElementById('login-toggle');
    this.#loginDropdown = document.getElementById('login-dropdown');
  }

  // this does what the name implies
  #setupEventListeners() {
    this.#registerForm.addEventListener("submit", (event) => this.#accessRequest(event));
    this.#loginForm.addEventListener("submit", (event) => this.#accessRequest(event));
    this.#logoutButton.addEventListener("click", () => this.#logUserOut());
    this.#loginToggle.addEventListener("click", () => this.#loginDropdown.classList.toggle('hidden'));

    document.body.addEventListener('click', (e) => {
      if (!this.#loginDropdown.contains(e.target) && e.target !== this.#loginToggle) {
        this.#loginDropdown.classList.add('hidden');
      }
    });
  }

  // function to login/register
  async #accessRequest(event) {
    event.preventDefault();
    const form = event.target;
    const action = form.getAttribute('action');
    const url = new URL(action, this.#backendUrl);
    const method = form.getAttribute('method').toUpperCase();
    const dataOut = {
      username: form.elements.username.value,
      password: form.elements.password.value
    };

    try {
      const response = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataOut),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      if (action === '/api/auth/login') {
        const jwtToken = await response.json();
        const session = new UserSession(dataOut.username, jwtToken.access_token);
        localStorage.setItem('userSession', JSON.stringify(session));
        this.#updateLoginInterface(true);
      } else if (action === '/api/auth/register') {
        form.reset();
      }

    } catch (error) {
      console.error(error.message);
    }
  }

  // simple logout function
  #logUserOut() {
    localStorage.removeItem('userSession');
    this.#updateLoginInterface(false);
    console.log("User logged out");
  }

  // updates ui based on logged state
  #updateLoginInterface(isUserLoggedIn) {
    this.#loginForm.classList.toggle('hidden', isUserLoggedIn);
    this.#registerForm.classList.toggle('hidden', isUserLoggedIn);
    this.#logoutButton.classList.toggle('hidden', !isUserLoggedIn);

    setLang(localStorage.getItem('lang') || 'zh');
  }

  // validates session on page load
  async #sessionValidation() {
    const sessionJSON = localStorage.getItem('userSession');
    if (!sessionJSON) {
      this.#updateLoginInterface(false);
      return;
    }

    const userSession = UserSession.fromObject(JSON.parse(sessionJSON));
    if (!userSession) {
      localStorage.removeItem('userSession');
      this.#updateLoginInterface(false);
      return;
    }

    console.log('Validating session...');
    const url = new URL("/api/auth/profile", this.#backendUrl);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${userSession.getToken()}` }
      });

      if (!response.ok) {
        console.warn("Invalid token. Ending session");
        localStorage.removeItem('userSession');
        this.#updateLoginInterface(false);
      }

      const userData = await response.json();
      console.log("Session authenticated:", userData);
      this.#updateLoginInterface(true);

    } catch (error) {
      console.error("Session validation failed:", error);
      this.#updateLoginInterface(false);
    }
  }
}

// class to handle the filter sidebar
class FilterManager {

  #filterToggle;
  #filterSidebar;
  #filterCloseBtn;
  #resetFiltersBtn;
  #applyFiltersBtn;
  #filterTabsContainer;
  #filterListContainer;
  #continentSelect;
  #countrySelect;
  #backendUrl = "https://terratune-backend.onrender.com";

  constructor() {
    this.#cacheDOMElements();
    this.#setupEventListeners();
    this.#populateFilters(); // initialization of the filter UI
  }

  #cacheDOMElements() {
    this.#filterToggle = document.getElementById("filter-toggle");
    this.#filterSidebar = document.getElementById("filter-list-sidebar");
    this.#filterCloseBtn = document.getElementById("filter-list-close");
    this.#resetFiltersBtn = document.getElementById("reset-filters-btn");
    this.#applyFiltersBtn = document.getElementById("apply-filters-btn");
    this.#filterTabsContainer = document.getElementById('filter-list-tabs');
    this.#filterListContainer = document.getElementById('filter-list-container');
  }

  #setupEventListeners() {
    this.#filterToggle.addEventListener("click", () => this.#filterSidebar.classList.toggle("hidden"));
    this.#filterCloseBtn.addEventListener("click", () => this.#filterSidebar.classList.add("hidden"));
    this.#resetFiltersBtn.addEventListener("click", () => this.#resetFilters());
    this.#applyFiltersBtn.addEventListener("click", () => this.#applyFilters());
  }

  // populates the filter sidebar
  async #populateFilters() {
    const tagDict = await this.#getAllTags();

    for (const cat in tagDict) {
      const queryCat = (cat === "Music Genre") ? "genre" : cat.toLowerCase();
      const tabEl = this.#createDOMElement('div', { 'data-category': queryCat, className: 'sidebar-tab', textContent: cat });
      const listEl = this.#createDOMElement('ul', { 'data-category': queryCat, className: 'filter-list' });

      tagDict[cat].forEach(tag => {
        const checkbox = this.#createDOMElement('input', { type: 'checkbox', 'data-category': queryCat, value: tag });
        const labelText = this.#createDOMElement('span', { textContent: tag, style: 'margin-left: 5px;' });
        const label = this.#createDOMElement('label', {}, [checkbox, labelText]);
        const listItem = this.#createDOMElement('li', { className: 'tag-element' }, [label]);
        listEl.appendChild(listItem);
      });

      this.#filterTabsContainer.appendChild(tabEl);
      this.#filterListContainer.appendChild(listEl);
    }

    this.#addRegionalFilter();
    this.#initTabLogic();
    this.#initCountrySelectLogic();
  }

  // helper to create DOM elements
  #createDOMElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    for (const key in attributes) {
      if (key === 'className') {
        element.classList.add(...attributes[key].split(' '));
      } else if (key.startsWith('data-')) {
        element.dataset[key.substring(5)] = attributes[key];
      }
      else {
        element[key] = attributes[key];
      }
    }
    children.forEach(child => element.appendChild(child));
    return element;
  }


  #addRegionalFilter() {
    const countryTab = this.#createDOMElement('div', { 'data-category': 'countrycode', className: 'sidebar-tab', textContent: "Country" });
    this.#filterTabsContainer.appendChild(countryTab);

    this.#continentSelect = this.#createDOMElement('select', { id: 'continent-select', className: 'filter-countries' });
    this.#continentSelect.appendChild(this.#createDOMElement('option', { textContent: "Select Continent" }));
    Object.keys(CONTINENT_COUNTRY_MAP).forEach(continent => {
      this.#continentSelect.appendChild(this.#createDOMElement('option', { value: continent, textContent: continent }));
    });

    this.#countrySelect = this.#createDOMElement('select', { id: 'country-select', className: 'filter-countries', disabled: true });
    this.#countrySelect.appendChild(this.#createDOMElement('option', { textContent: "Select Country" }));

    const dropdownContainer = this.#createDOMElement('div', { id: 'country-filter-container' }, [this.#continentSelect, this.#countrySelect]);
    const countryFilterList = this.#createDOMElement('div', { className: 'filter-list' }, [dropdownContainer]);
    this.#filterListContainer.appendChild(countryFilterList);
  }

  #initTabLogic() {
    const tabs = this.#filterTabsContainer.querySelectorAll('.sidebar-tab');
    const lists = this.#filterListContainer.querySelectorAll('.filter-list');

    if (tabs.length !== lists.length) {
      console.error("Filter tabs and lists count mismatch.");
      return;
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        lists.forEach(l => l.classList.remove('active'));
        tab.classList.add('active');
        lists[index].classList.add('active');
      });
    });
  }

  #initCountrySelectLogic() {
    this.#continentSelect.addEventListener("change", () => {
      const selectedContinent = this.#continentSelect.value;
      this.#countrySelect.innerHTML = ''; // Clear existing options
      this.#countrySelect.appendChild(this.#createDOMElement('option', { textContent: 'Select Country' }));

      if (selectedContinent && CONTINENT_COUNTRY_MAP[selectedContinent]) {
        this.#countrySelect.disabled = false;
        CONTINENT_COUNTRY_MAP[selectedContinent].forEach(country => {
          this.#countrySelect.appendChild(this.#createDOMElement('option', { value: country, textContent: country }));
        });
      } else {
        this.#countrySelect.disabled = true;
      }
    });
  }

  // gathers all selected filter values from the UI
  #collectFilterValues() {
    const selectedFilters = {};
    const checkedCheckboxes = this.#filterListContainer.querySelectorAll('input[type="checkbox"]:checked');

    checkedCheckboxes.forEach(checkbox => {
      const category = checkbox.dataset.category;
      if (!selectedFilters[category]) {
        selectedFilters[category] = [];
      }
      selectedFilters[category].push(checkbox.value);
    });

    const countryValue = this.#countrySelect.value;
    if (countryValue && !countryValue.toLowerCase().includes('select')) {
      const countryData = COUNTRY_MAIN_TZ[countryValue.toLowerCase()];
      if (countryData) {
        selectedFilters['countrycode'] = [countryData.countryCode];
      }
    }
    return selectedFilters;
  }

  // generates query string from a data object
  #generateQueryString(filters) {
    const params = Object.entries(filters).map(([category, values]) => {
      return `${encodeURIComponent(category)}=${encodeURIComponent(values.join(','))}`;
    });
    return params.length > 0 ? `?${params.join('&')}` : '';
  }

  async #queryStations(queryString, page = 1, per_page = 20) {
    const pageParam = `${queryString ? '&' : '?'}page=${page}&per_page=${per_page}`;
    const url = new URL(`/api/stations${queryString}${pageParam}`, this.#backendUrl);

    console.log("Fetching URL:", url.href);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error("Error fetching data: ", error.message);
      throw error;
    }
  }

  #resetFilters() {
    this.#filterListContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    this.#continentSelect.selectedIndex = 0;
    this.#countrySelect.selectedIndex = 0;
    this.#countrySelect.disabled = true;
  }

  async #applyFilters() {
    const filters = this.#collectFilterValues();
    const queryString = this.#generateQueryString(filters);

    try {
      const stationList = await this.#queryStations(queryString);
      console.log("Filtered Stations:", stationList);
    } catch (error) {
      console.error("Error applying filters: ", error.message);
    }
  }

  // methods to retrieve tags from backend
  async #getAllTags() {
    try {
      const categories = await this.#getCategories();
      if (!categories || categories.length === 0) return {};

      const tagPromises = categories.map(cat => this.#getTags(cat).then(tags => ({ [cat]: tags || [] })));
      const allTagsArrays = await Promise.all(tagPromises);

      return Object.assign({}, ...allTagsArrays);
    } catch (error) {
      console.error(error.message);
      return {};
    }
  }

  async #getCategories() {
    const url = new URL("/api/tags/categories", this.#backendUrl);
    try {
      const response = await fetch(url);
      return response.ok ? await response.json() : [];
    } catch (error) {
      console.error(error.message);
      return [];
    }
  }

  async #getTags(category) {
    const url = new URL(`/api/tags/${category}`, this.#backendUrl);
    try {
      const response = await fetch(url);
      return response.ok ? await response.json() : [];
    } catch (error) {
      console.error(`Error for ${category}:`, error.message);
      return [];
    }
  }
}

class StationManager {
  #stationToggle;
  #stationSidebar;
  #stationCloseBtn;
  #stationTabsContainer;
  #stationListContainer;
  #backendUrl = "https://terratune-backend.onrender.com";
  #globeRadio


  constructor(globeRadioInstance) {
    this.#globeRadio = globeRadioInstance;
    this.#cacheDOMElements();
    this.#setupEventListeners();
    // this.#populateStations(); // initialization of the stations UI
  }

  #cacheDOMElements() {
    this.#stationToggle = document.getElementById("station-toggle");
    this.#stationSidebar = document.getElementById("station-list-sidebar");
    this.#stationCloseBtn = document.getElementById("station-list-close");
    this.#stationTabsContainer = document.getElementById('station-list-tabs');
    this.#stationListContainer = document.getElementById('station-list-container');
  }

  #setupEventListeners() {
    this.#stationToggle.addEventListener("click", () => this.#stationSidebar.classList.toggle("hidden"));
    this.#stationCloseBtn.addEventListener("click", () => this.#stationSidebar.classList.add("hidden"));
  }
}

// class to save the login jwt token
// maybe too fancy, but it's clearer this way
class UserSession {
  constructor(username, jwtToken) {
    this.username = username;
    this._jwtToken = jwtToken;
  }
  getToken() {
    return this._jwtToken;
  }
  static fromObject(data) {
    if (!data || !data.username || !data._jwtToken) return null;
    return new UserSession(data.username, data._jwtToken);
  }
}


