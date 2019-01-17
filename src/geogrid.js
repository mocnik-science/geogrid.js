"use strict"

require('./geogrid.scss')
const isea3hWorker = require('./geogrid.worker.js').isea3hWorker

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
    this._map.on('mousemove', this._onMouseMove)
    this._map.on('mouseout', this._onMouseOut)
    this._map.on('click', this._onClick)
    
    // events
    this._map.on('viewreset', this._onReset, this)
    this._map.on('zoomend', this._onReset, this)
    this._map.on('moveend', this._onReset, this)
  },
  onRemove: function(map) {
    clearTimeout(this._progresBarTimeoutReset)
    this._progressBar.remove()
    this._removeRender(map)
    this._webWorker.terminate()
    
    // plugins
    this._map.off('mousemove', this._onMouseMove)
    this._map.off('mouseout', this._onMouseOut)
    this._map.off('click', this._onClick)
    
    // events
    this._map.off('viewreset', this._onReset, this)
    this._map.off('zoomend', this._onReset, this)
    this._map.off('moveend', this._onReset, this)
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
  _reduceGeoJSON() {
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
  _visualizeData() {
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
    this._onReset()
    // layer has been initialized
    this._initialized = true
  },
  _onMouseMove(e) {
    if (this._pluginsOnHover && this._initialized) this._webWorker.postMessage({
      task: 'findCell',
      taskResult: 'resultPluginsHover',
      lat: e.latlng.lat,
      lon: e.latlng.lng,
    })
  },
  _onMouseOut(e) {
    if (this._hoveredCells === undefined) return
    for (const cell of this._hoveredCells) {
      const ePlugin = {
        cell: cell,
      }
      for (let p of this._plugins) if (p.onUnhover !== undefined) p.onUnhover(ePlugin)
    }
    this._hoveredCells = []
  },
  _onClick(e) {
    if (this._pluginsOnHover && this._initialized) this._webWorker.postMessage({
      task: 'findCell',
      taskResult: 'resultPluginsClick',
      lat: e.latlng.lat,
      lon: e.latlng.lng,
    })
  },
  _onReset(e) {
    if (this._geoJSON === undefined) return
    // reset after zooming, etc.
    const geoJSONreduced = this._reduceGeoJSON()
    if (this._geoJSON.features.length) this._updateRender(geoJSONreduced)
    if ((!this._bboxData.contains(this._bboxView)) || (this.options.resolution(this._map.getZoom()) !== this._resolutionData)) this._updateData()
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
