"use strict"

require('./geogrid.scss')

if (typeof L === 'undefined') throw '[geogrid.js] Leaflet needs to be loaded first'
if (typeof d3 === 'undefined') throw '[geogrid.js] D3.js needs to be loaded first'

/****** PLUGIN ******/
L.ISEA3HLayerPlugin = class ISEA3HLayerPlugin {
  onAdd(layer) {
    this._layer = layer
  }
  downloadData() {
    this._layer._updateData()
  }
  render() {
    this._layer._render()
  }
  neighbors(cell, callback) {
    return this._layer._neighbors(cell, callback)
  }
  getParameter(parameter) {
    return this._layer.options.parameters[parameter]
  }
  setParameter(parameter, value) {
    this._layer.options.parameters[parameter] = value
  }
  setCellColor(cell, value) {
    if (value) this._layer._overwriteColor[cell.id] = value
    else delete this._layer._overwriteColor[cell.id]
  }
  resetCellColor() {
    this._layer._overwriteColor = {}
  }
  setCellSize(cell, value) {
    if (value) this._layer._overwriteSize[cell.id] = value
    else delete this._layer._overwriteSize[cell.id]
  }
  resetCellSize() {
    this._layer._overwriteSize = {}
  }
}

/****** LAYER ******/
L.ISEA3HLayer = L.Layer.extend({
  options: {
    url: null,
    data: null,
    silent: true,
    debug: false,
    resolution: s => {
      if (s <= 3) return 4
      if (s <= 5) return 6
      if (s <= 6) return 8
      if (s <= 9) return 12
      return 14
    },
    parameters: {
      date: new Date().toLocaleDateString(),
      dateFrom: null,
    },
    cellColorKey: 'value',
    cellColorMin: 0,
    cellColorMax: null,
    cellColorScale: (min, max) => d3.scaleLinear().domain([min, max]).range(['#fff', '#f00']),
    cellColorNoData: '#eee',
    cellColorNoKey: '#f00',
    cellColorOpacity: .5,
    cellSizeKey: null,
    cellSizeMin: 0,
    cellSizeMax: null,
    cellSizeScale: (min, max) => {return value => (value - min) / (max - min)},
    cellSizeNoData: 0,
    cellSizeNoKey: 1,
    cellContourColor: null,
    cellContourWidth: 2,
    colorProgressBar: '#ff5151',
    colorDebug: '#1e90ff',
    colorDebugEmphasized: '#f00',
    attribution: '&copy; <a href="http://www.geog.uni-heidelberg.de/gis">Heidelberg University</a>',
    bboxViewPad: 1.1,
    bboxDataPad: 1.4,
    renderer: 'webgl',
    urlLibs: '/libs',
  },
  initialize: function(options) {
    this._initialized = false

    // init options
    L.Util.setOptions(this, options)
    if (this.options.debug) this.options.silent = false
    if (!this.options.cellContourColor) this.options.cellContourColor = (this.options.debug) ? this.options.colorDebug : '#fff'
    if (this.options.bboxViewPad < 1) {
      this._error('bboxViewPad must be larger than 1')
      this.options.bboxViewPad = 1
    }
    if (this.options.bboxDataPad < 1) {
      this._error('bboxDataPad must be larger than 1')
      this.options.bboxDataPad = 1
    }
    if (this.options.bboxDataPad < this.options.bboxViewPad) {
      this._error('bboxDataPad must be larger or equal than bboxViewPad')
      this.options.bboxDataPad = this.options.bboxViewPad
    }
    this._cellColorScale = null
    this._cellSizeScale = null

    // init plugins
    this._plugins = []
    this._pluginCallbacks = {}
    this._hoveredCells = []
    this._overwriteColor = {}
    this._overwriteSize = {}

    // init progress bar
    this._progressBar = document.createElement('div')
    this._progressBar.style.backgroundColor = this.options.colorProgressBar
    const backgroundColor = d3.color(this.options.colorProgressBar)
    backgroundColor.opacity = .7
    this._progressBar.style.boxShadow = `0 1px 4px ${backgroundColor}`
    document.getElementsByTagName('body')[0].appendChild(this._progressBar)
    this._progress(100)

    // choose renderer
    if (this.options.renderer.toLowerCase() == 'svg') {
      this._addRender = this._addSVG
      this._removeRender = this._removeSVG
      this._renderRender = this._renderSVG
      this._updateRender = this._updateSVG
    } else {
      if (typeof PIXI === 'undefined') this._error('pixi.js needs to be loaded first')
      if (typeof L.pixiOverlay === 'undefined') this._error('Leaflet.PixiOverlay needs to be loaded first')
      this._addRender = this._addWebGL
      this._removeRender = this._removeWebGL
      this._renderRender = this._renderWebGL
      this._updateRender = this._updateWebGL
    }

    // create web worker
    let url = null
    if (this.options.urlLibs.startsWith('http')) url = this.options.urlLibs
    else if (this.options.urlLibs.startsWith('/')) url = `${document.location.protocol}//${document.location.hostname}${document.location.port ? `:${document.location.port}` : ''}${this.options.urlLibs}`
    else {
      url = document.location.href.split('/')
      url = `${url.splice(0, url.length - 1).join('/')}/${this.options.urlLibs}`
    }
    const workerFunctionString = `(${isea3hWorker.toString()})()`.replace('importScripts(\'./vptree.js/vptree.min.js\')', `importScripts('${url}/vptree.js/vptree.min.js')`)
    this._webWorker = new Worker(URL.createObjectURL(new Blob([workerFunctionString])))
    this._webWorker.addEventListener('message', e => {
      const d = e.data
      switch (d.task) {
        case 'log':
          this._log(d.message)
          break
        case 'progress':
          this._progress(d.percent)
          break
        case 'debugStep':
          this._debugStep(d.title, d.percent)
          break
        case 'debugFinished':
          this._debugFinished()
          break
        case 'resultComputeCells':
          this._cells = d.cells
          this._produceGeoJSON()
          break
        case 'resultPluginsHover':
          if (!this._hoveredCells.map(c => c.idLong).includes(d.cell.idLong)) {
            const ePlugin = {
              lat: d.lat,
              lon: d.lon,
              cell: d.cell,
            }
            for (const cell of this._hoveredCells) {
              const ePlugin2 = {
                lat: d.lat,
                lon: d.lon,
                cell: cell,
              }
              if (cell.idLong !== ePlugin.cell.idLong) for (let p of this._plugins) if (p.onUnhover !== undefined) p.onUnhover(ePlugin2)
            }
            this._hoveredCells = [d.cell]
            for (let p of this._plugins) if (p.onHover !== undefined) p.onHover(ePlugin)
          }
          break
        case 'resultPluginsClick':
          const ePlugin = {
            lat: d.lat,
            lon: d.lon,
            cell: d.cell,
          }
          for (let p of this._plugins) if (p.onClick !== undefined) p.onClick(ePlugin)
          break
        case 'resultFindNeighbors':
          this._execPluginCallback(d.uid, d.neighbors)
          break
      }
    })
  },
  onAdd: function(map) {
    this._map = map
    this._addRender(map)
    this._updateData()

    // plugins
    this._map.on('mousemove', e => {
      if (this._pluginsOnHover && this._initialized) this._webWorker.postMessage({
        task: 'findCell',
        taskResult: 'resultPluginsHover',
        lat: e.latlng.lat,
        lon: e.latlng.lng,
      })
    })
    this._map.on('mouseout', e => {
      for (const cell of this._hoveredCells) {
        const ePlugin = {
          cell: cell,
        }
        for (let p of this._plugins) if (p.onUnhover !== undefined) p.onUnhover(ePlugin)
      }
      this._hoveredCells = []
    })
    this._map.on('click', e => {
      if (this._pluginsOnHover && this._initialized) this._webWorker.postMessage({
        task: 'findCell',
        taskResult: 'resultPluginsClick',
        lat: e.latlng.lat,
        lon: e.latlng.lng,
      })
    })
  },
  onRemove: function(map) {
    clearTimeout(this._progresBarTimeoutReset)
    this._progressBar.remove()
    this._removeRender(map)
    this._webWorker.terminate()
  },
  addPlugin: function(plugin) {
    plugin.onAdd(this)
    this._plugins.push(plugin)
    if (plugin.onHover !== undefined) this._pluginsOnHover = true
    if (plugin.onClick !== undefined) this._pluginsOnClick = true
  },
  _log: function(message) {
    console.log(`[geogrid.js] ${message}`)
  },
  _error: function(message) {
    throw `[geogrid.js] ${message}`
  },
  _progress: function(percent=100) {
    if (this._progresBarTimeoutReset !== undefined) {
      clearTimeout(this._progresBarTimeoutReset)
      this._progresBarTimeoutReset = undefined
    }
    if (this.noProgress) return
    if (0 < percent && percent < 100) this._progressBar.className = 'progressBar'
    else {
      this._progressBar.className = 'progressBarHidden'
      this._progresBarTimeoutReset = setTimeout(() => {
        this._progresBarTimeoutReset = undefined
        this._progressBar.style.width = '0%'
        this._progressBar.className = 'progressBarReset'
      }, 700)
    }
    this._progressBar.style.width = `${percent}%`
  },
  _showProgress: function() {
    this.noProgress = false
  },
  _debugStep: function(title, percent=null) {
    if (percent !== null) this._progress(percent)
    if (!this.options.silent) {
      const t = (new Date()).getTime()
      if (this._debugTimestamp != null && this._debugTitle != null) this._log(`${this._debugTitle} (${t - this._debugTimestamp}ms)`)
      this._debugTimestamp = t
      this._debugTitle = title
    }
  },
  _debugFinished: function() {
    this._progress(100)
    if (!this.options.silent) {
      if (this._debugTimestamp != null && this._debugTitle != null) this._log(`${this._debugTitle} (${(new Date()).getTime() - this._debugTimestamp}ms)`)
      this._debugTimestamp = null
      this._debugTitle = null
    }
    this.noProgress = true
  },
  _uuidv4: function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  },
  _storePluginCallback: function(callback) {
    const uid = this._uuidv4()
    this._pluginCallbacks[uid] = callback
    return uid
  },
  _execPluginCallback: function(uid, ...es) {
    this._pluginCallbacks[uid](...es)
    delete this._pluginCallbacks[uid]
  },
  _neighbors: function(cell, callback) {
    this._webWorker.postMessage({
      task: 'findNeighbors',
      taskResult: 'resultFindNeighbors',
      uid: this._storePluginCallback(callback),
      idLong: cell.idLong,
    })
  },
  _updateData: function() {
    const t = this
    // download the data
    this._showProgress()
    this._debugStep('download data', 5)
    if (this.options.url) {
      const b = this._bboxData = this._map.getBounds().pad(this.options.bboxDataPad)
      const r = this._resolutionData = this.options.resolution(this._map.getZoom())
      let url = this.options.url
        .replace('{bbox}', b.toBBoxString())
        .replace('{resolution}', r)
      for (const p in this.options.parameters) url = url.replace(`{${p}}`, (this.options.parameters[p] !== null) ? this.options.parameters[p] : '')
      if (this.options.debug || !this.options.silent) this._log(url)
      d3.json(url, data => {
        t.options.data = data
        t._processData()
      })
    } else if (this.options.data) this._processData()
  },
  _processData: function() {
    // update scales
    this._updateScales()
    // call web worker
    this._webWorker.postMessage({
      task: 'computeCells',
      json: this.options.data,
      url: document.location.href,
      bbox: {
        north: this._bboxData.getNorth(),
        south: this._bboxData.getSouth(),
        west: this._bboxData.getWest(),
        east: this._bboxData.getEast(),
      },
    })
  },
  _produceGeoJSON: function() {
    // produce GeoJSON
    this._debugStep('produce GeoJSON', 65)
    const features = []
    const keysToCopy = (this._cells.length > 0) ? Object.keys(this._cells[0]).filter(k => !(k in ['lat', 'lon', 'isPentagon'])) : []
    for (let c of this._cells) {
      if (c.vertices !== undefined) {
        const properties = {}
        for (const k of keysToCopy) properties[k] = c[k]
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [c.vertices],
          },
          properties: properties,
        })
      }
    }
    this._geoJSON = {
      type: 'FeatureCollection',
      features: features,
    }
    // visualize data
    this._visualizeData()
  },
  _reduceGeoJSON: function() {
    // save bounds and return cached GeoJSON in case of unchanged bounds
    const b = this._map.getBounds().pad(this.options.bboxViewPad)
    if (b.equals(this._bboxView)) return this._geoJSONreduced
    this._bboxView = b
    // reduce
    this._debugStep('reduce GeoJSON for area', 70)
    this._geoJSONreduced = {
      type: 'FeatureCollection',
      features: [],
    }
    for (let f of this._geoJSON.features) if (b.intersects(L.latLngBounds(f.geometry.coordinates[0].map(c => [c[1], c[0]])))) this._geoJSONreduced.features.push(f)
    // return
    return this._geoJSONreduced
  },
  _visualizeData: function() {
    const t = this
    const geoJSON = this._geoJSON
    // visualize
    if (geoJSON.features.length) {
      // visualize centroids
      if (t._centroids != null) for (let c of t._centroids) c.remove()
      t._centroids = []
      if (t.options.debug) {
        this._debugStep('visualize centroids', 75)
        for (let d of t._cells) {
          const circle = L.circle([d.lat, d.lon], {
            color: (d.isPentagon) ? t.options.colorDebugEmphasized : t.options.colorDebug,
            fill: (d.isPentagon) ? t.options.colorDebugEmphasized : t.options.colorDebug,
            radius: 3}
          ).on('mouseover', e => console.debug(e.target._d)).addTo(t._map)
          circle._d = d
          t._centroids.push(circle)
        }
      }
      // visualize cells
      this._render()
    }
    // reset after zooming, etc.
    const reset = () => {
      const geoJSONreduced = this._reduceGeoJSON()
      if (geoJSON.features.length) t._updateRender(geoJSONreduced)
      if ((!t._bboxData.contains(t._bboxView)) || (t.options.resolution(t._map.getZoom()) !== t._resolutionData)) t._updateData()
    }
    this._map.on('viewreset', reset)
    this._map.on('zoomend', reset)
    this._map.on('moveend', reset)
    reset()
    // layer has been initialized
    this._initialized = true
  },
  _updateScales() {
    if (!this.options.data || !this.options.data.data) return
    const t = this
    const computeScale = (scale, min, max, value) => {
      if (value == null) return null
      if (scale.length != 2) return scale
      let values = Object.values(t.options.data.data).map(x => x[value]).filter(x => x !== null)
      if (values.length == 0) values = [0]
      const minComputed = (min) ? min : Math.min(...values)
      const maxComputed = (max) ? max : Math.max(...values)
      return scale(minComputed, maxComputed)
    }
    this._cellColorScale = computeScale(this.options.cellColorScale, this.options.cellColorMin, this.options.cellColorMax, this.options.cellColorKey)
    this._cellSizeScale = computeScale(this.options.cellSizeScale, this.options.cellSizeMin, this.options.cellSizeMax, this.options.cellSizeKey)
  },
  _cellColor(id, properties) {
    // return overwritten colour
    if (id in this._overwriteColor) return this._overwriteColor[id]
    // no key
    if (this.options.cellColorKey == null) return this.options.cellColorNoKey
    // compute value
    const value = properties[this.options.cellColorKey]
    // return if empty value
    if (value == null) return this.options.cellColorNoData
    // return if no scale
    if (this._cellColorScale == null) return this.options.cellColorNoKey
    // compute colour
    return this._cellColorScale(value)
  },
  _cellSize(id, properties, geometry) {
    let relativeSize
    // choose overwritten relative size
    if (id in this._overwriteSize) relativeSize = this._overwriteSize[id]
    // no key
    else if (this.options.cellSizeKey == null) relativeSize = this.options.cellSizeNoKey
    else {
      // compute value
      const value = properties[this.options.cellSizeKey]
      // empty value
      if (value == null) relativeSize = this.options.cellSizeNoData
      // no scale
      else if (this._cellSizeScale == null) relativeSize = this.options.cellSizeNoKey
      // compute relative size
      else relativeSize = this._cellSizeScale(value)
    }
    // if no resize needed, return geometry
    if (relativeSize == 1) return geometry
    // resize geometry
    const centroid = geometry.reduce(([x0, y0], [x1, y1]) => [x0 + x1, y0 + y1]).map(c => c / geometry.length)
    return geometry.map(([x, y]) => [relativeSize * (x - centroid[0]) + centroid[0], relativeSize * (y - centroid[1]) + centroid[1]])
  },
  _render() {
    this._renderRender(this._reduceGeoJSON())
  },
  _addSVG: function(map) {
    this._svg = d3.select(this._map.getPanes().overlayPane).append('svg').attr('position', 'relative')
    this._g = this._svg.append('g').attr('class', 'leaflet-zoom-hide')
  },
  _removeSVG: function(map) {
    this._svg.remove()
  },
  _renderSVG: function(geoJSON) {
    this._debugStep('visualize (SVG)', 80)
    const t = this
    this._g.selectAll('path').remove()
    this._visHexagons = this._g.selectAll('path')
      .data(geoJSON.features)
      .enter().append('path')
        .attr('fill', feature => t._cellColor(feature.properties.id, feature.properties))
        .attr('stroke', t.options.cellContourColor)
        .attr('stroke-width', t.options.cellContourWidth)
        .attr('opacity', this.options.cellColorOpacity)
    this._updateSVG(geoJSON)
  },
  _updateSVG: function(geoJSON) {
    this._debugStep('visualize - update (SVG))', 90)
    const t = this
    const projectPoint = function (x, y) {
      const point = t._map.latLngToLayerPoint(L.latLng(y, x))
      this.stream.point(point.x, point.y)
    }
    const transform = d3.geoTransform({point: projectPoint})
    const path = d3.geoPath(transform)
    const bounds = path.bounds(geoJSON)
    this._svg
      .attr('width', bounds[1][0] - bounds[0][0])
      .attr('height', bounds[1][1] - bounds[0][1])
      .style('left', `${bounds[0][0]}px`)
      .style('top', `${bounds[0][1]}px`)
    this._g.attr('transform', `translate(${-bounds[0][0]},${-bounds[0][1]})`)
    this._visHexagons.attr('d', feature => path({
      type: feature.type,
      geometry: {
        type: feature.geometry.type,
        coordinates: [
          t._cellSize(feature.properties.id, feature.properties, feature.geometry.coordinates[0]),
        ],
      },
      properties: feature.properties,
    }))
    this._debugFinished()
  },
  _addWebGL: function(map) {
    const t = this
    const pixiColor = color => {
      const c = d3.color(color).rgb()
      return PIXI.utils.rgb2hex([c.r / 255, c.g / 255, c.b / 255])
    }
    const pixiContainer = new PIXI.Container()
    const pixiGraphics = new PIXI.Graphics()
    pixiContainer.addChild(pixiGraphics)
    let prevZoom
    let prevOverwriteColor
    let prevOverwriteSize
    this._webgl = L.pixiOverlay(utils => {
      // if no geoJSON present, do nothing
      if (t._geoJSON == null || t._geoJSON.features == null) return
      // log
      const renderer = utils.getRenderer()
      t._debugStep(`visualize (${(renderer instanceof PIXI.CanvasRenderer) ? 'Canvas' : 'WebGL'})`, 90)
      // collect utils
      const zoom = utils.getMap().getZoom()
      const container = utils.getContainer()
      const project = utils.latLngToLayerPoint
      const scale = utils.getScale()
      // colours
      const cellContourColor = pixiColor(t.options.cellContourColor)
      // check whether a referesh is need
      const needsRefresh = prevZoom != zoom || prevOverwriteColor != JSON.stringify(this._overwriteColor) || prevOverwriteSize != JSON.stringify(this._overwriteSize)
      prevZoom = zoom
      prevOverwriteColor = JSON.stringify(this._overwriteColor)
      prevOverwriteSize = JSON.stringify(this._overwriteSize)
      // if new geoJSON, cleanup and initialize
      if (t._geoJSON._webgl_initialized == null || needsRefresh) {
        t._geoJSON._webgl_initialized = true
        pixiGraphics.clear()
        pixiGraphics.lineStyle(t.options.cellContourWidth / scale, cellContourColor, 1)
      }
      // draw geoJSON features
      for (const feature of t._geoJSON.features) {
        const notInitialized = (feature._webgl_coordinates == null)
        if (notInitialized) feature._webgl_coordinates = t._cellSize(feature.properties.id, feature.properties, feature.geometry.coordinates[0]).map(c => project([c[1], c[0]]))
        if (notInitialized || needsRefresh) {
          pixiGraphics.beginFill(pixiColor(t._cellColor(feature.properties.id, feature.properties)), t.options.cellColorOpacity)
          pixiGraphics.drawPolygon([].concat(...feature._webgl_coordinates.map(c => [c.x, c.y])))
          pixiGraphics.endFill()
        }
      }
      renderer.render(container)
      t._debugFinished()
    }, pixiContainer).addTo(map)
  },
  _removeWebGL: function(map) {
    this._webgl.remove()
  },
  _renderWebGL: function(geoJSON) {
    this._webgl._update(null)
  },
  _updateWebGL: function(geoJSON) {},
})

L.isea3hLayer = options => new L.ISEA3HLayer(options)

/****** WORKER ******/
const isea3hWorker = () => {
  importScripts('./vptree.js/vptree.min.js')

  // helping functions
  const log = message => postMessage({task: 'log', message: message})
  const error = message => {throw message}
  const progress = percent => postMessage({task: 'progress', percent: percent})
  const debugStep = (title, percent) => postMessage({task: 'debugStep', title: title, percent: percent})

  // message handler
  onmessage = e => {
    const d = e.data
    switch (d.task) {
      case 'computeCells':
        postMessage({
          task: 'resultComputeCells',
          cells: computeGeoJSON(d.json, d.bbox),
        })
        break
      case 'findCell':
        postMessage({
          task: d.taskResult,
          cell: findCell(d.lat, d.lon),
          lat: d.lat,
          lon: d.lon,
        })
        break
      case 'findNeighbors':
        postMessage({
          task: 'resultFindNeighbors',
          uid: d.uid,
          neighbors: findNeighbors(d.idLong),
        })
        break
    }
  }

  // constants
  const rad = Math.PI / 180
  const radCircle = 2 * Math.PI

  // caches
  let cacheNeighbors = {}
  let cacheVertices = {}
  let keysToCopy = []
  let data = null
  let cells = null
  let tree = null

  // helping function: clean up data about cells
  const cleanupCell = c => {
    const cell = {
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      isPentagon: c.isPentagon,
    }
    if (c.filtered !== false) cell.vertices = c.vertices
    for (k of keysToCopy) cell[k] = c[k]
    return cell
  }

  // compute GeoJSON
  const computeGeoJSON = (json, bbox) => {
    // handle errors
    if (json == null) error('data error - no data')
    if (json.error) error(`data error - ${json.message}`)

    // get properties to copy
    keysToCopy = (json.data.length > 0) ? Object.keys(json.data[0]).filter(k => !(k in ['lat', 'lon'])) : []

    // make data complete by repetition
    debugStep('make data complete by repetition', 10)
    data = []
    const minLonN = Math.floor((bbox.west + 180) / 360)
    const maxLonN = Math.ceil((bbox.east - 180) / 360)
    const west = bbox.west - 5
    const east = bbox.east + 5
    const repeatNumber = Math.ceil((bbox.east - bbox.west) / 360)
    const explicitLatLon = json.data.length > 0 && json.data[0].lat !== undefined
    for (let i = minLonN; i <= maxLonN; i++) for (let d of json.data) {
      const isPentagon = d.id.startsWith('-')
      let lon
      let lat
      if (explicitLatLon) {
        lon = d.lon
        lat = d.lat
      } else {
        let idWithoutSign = (isPentagon) ? d.id.substr(1) : d.id
        if (idWithoutSign.length % 2 == 0) idWithoutSign = '0' + idWithoutSign
        const numberOfDecimalPlaces = (idWithoutSign.length - 2 - 5) / 2
        lat = parseInt(idWithoutSign.substr(2, numberOfDecimalPlaces + 2)) / Math.pow(10, numberOfDecimalPlaces)
        lon = parseInt(idWithoutSign.substr(2 + numberOfDecimalPlaces + 2)) / Math.pow(10, numberOfDecimalPlaces)
        const partB = parseInt(idWithoutSign.substr(0, 2))
        if ((partB >= 22 && partB < 44) || partB >= 66) lat *= -1
        if (partB >= 44) lon *= -1
      }
      const lonNew = lon + i * 360
      if (west <= lonNew && lonNew <= east) {
        dNew = {
          idLong: `${d.id}_${i}`,
          lat: lat,
          lon: lonNew,
          sinLat: Math.sin(lat * rad),
          cosLat: Math.cos(lat * rad),
          lonN: i,
          isPentagon: isPentagon,
          neighbors: cacheNeighbors[d.id],
          vertices: cacheVertices[d.id],
        }
        for (k of keysToCopy) dNew[k] = d[k]
        data.push(dNew)
      }
    }

    // load the data into a tree
    debugStep('load data into tree', 15)
    const Mathmin = (a, b) => (a < b) ? a : b
    tree = VPTreeFactory.build(data, (d0, d1) => Math.acos(Mathmin(d0.sinLat * d1.sinLat + d0.cosLat * d1.cosLat * Math.cos((d1.lon - d0.lon) * rad), 1)))

    // collect the data needed for a cell
    // in particular: find neighbours for the cells
    debugStep('collect the data needed for a cell', 20)
    cells = {}
    for (let d of data) {
      const numberOfNeighborsToLookFor = d.isPentagon ? 5 : 6
      if (d.neighbors == undefined) {
        d.neighbors = []
        for (let x of tree.search(d, 6 * (repeatNumber + 1) + 1).splice(1)) {
          const n = data[x.i]
          if (n.id !== d.id && Math.abs(d.lon - n.lon) < 180) d.neighbors.push(n.idLong)
          if (d.neighbors.length >= numberOfNeighborsToLookFor) break
        }
      }
      cells[d.idLong] = d
    }

    // filter cells I
    // filter cells by location of neighbours
    debugStep('filter cells I', 40)
    for (const id in cells) {
      const c = cells[id]
      if (c.vertices !== undefined) continue
      let numberOfMatchingNeighbors = 0
      for (let id2 of c.neighbors) if (cells[id2].neighbors.indexOf(id) >= 0) numberOfMatchingNeighbors++
      if (numberOfMatchingNeighbors < (c.isPentagon ? 5 : 6)) c.filtered = false
    }

    // compute angles and vertices
    debugStep('compute angles and vertices', 45)
    for (let id in cells) {
      const c = cells[id]
      if (c.filtered === false || c.vertices !== undefined) continue
      c.angles = []
      // compute angles
      for (let id2 of c.neighbors) {
        let n = cells[id2]
        const ncLon = (n.lon - c.lon) * rad
        c.angles.push({
          angle: Math.atan2(Math.sin(ncLon) * n.cosLat, c.cosLat * n.sinLat - c.sinLat * n.cosLat * Math.cos(ncLon)),
          lat: n.lat,
          lon: n.lon,
        })
      }
      // sort angles
      c.angles.sort((a, b) => (a.angle < b.angle) ? -1 : 1)
      // compute vertices
      c.vertices = []
      for (let i = 0; i <= c.angles.length; i++) {
        const n1 = c.angles[i % c.angles.length]
        const n2 = c.angles[(i + 1) % c.angles.length]
        c.vertices.push([(n1.lon + n2.lon + c.lon) / 3, (n1.lat + n2.lat + c.lat) / 3])
      }
    }

    // filter cells II
    // filter cells by their distortion
    debugStep('filter cells II', 50)
    for (let id in cells) {
      const c = cells[id]
      if (c.filtered === false) continue
      else if (c.isPentagon) continue
      else {
        let filter = true
        for (let i = 0; i < 6; i++) {
          const aBefore = Math.abs((c.angles[(i + 2 < 6) ? i + 2 : i - 4].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          const a = Math.abs((c.angles[(i + 3 < 6) ? i + 3 : i - 3].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          const aAfter = Math.abs((c.angles[(i + 4 < 6) ? i + 4 : i - 2].angle - c.angles[i].angle + radCircle) % radCircle - Math.PI)
          if ((aBefore < a) || (aAfter < a)) {
            filter = false
            break
          }
        }
        if (!filter) c.filtered = false
      }
    }

    // cache neighbours
    debugStep('cache neighbours', 55)
    for (let id in cells) cacheNeighbors[id] = cells[id].neighbors

    // cache vertices
    debugStep('cache vertices', 57.5)
    for (let id in cells) cacheVertices[id] = cells[id].vertices

    // clean up data about cells
    debugStep('clean up data about cells', 60)
    const cells2 = new Array(cells.length)
    let i = -1
    for (let id in cells) {
      i++
      cells2[i] = cleanupCell(cells[id])
    }

    return cells2
  }

  // find cell for given coordinates
  const findCell = (lat, lon) => {
    for (let x of tree.search({
      lat: lat,
      lon: lon,
      sinLat: Math.sin(lat * rad),
      cosLat: Math.cos(lat * rad),
    }, 1)) return data[x.i]
  }

  // find neighbors of a given cell
  const findNeighbors = idLong => cacheNeighbors[idLong].map(idLong2 => cleanupCell(cells[idLong2]))
}
