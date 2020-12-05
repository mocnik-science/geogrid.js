"use strict"

require('./geogrid.scss')
const Data = require('./geogrid.data.js').Data
const Progress = require('./geogrid.progress.js').Progress
const RendererWebGL = require('./geogrid.rendererWebGL.js').RendererWebGL
const RendererSVG = require('./geogrid.rendererSVG.js').RendererSVG
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
    if (value) this._layer._data._overwriteColor[cell.id] = value
    else delete this._layer._data._overwriteColor[cell.id]
  }
  resetCellColor() {
    this._layer._data._overwriteColor = {}
  }
  setCellSize(cell, value) {
    if (value) this._layer._data._overwriteSize[cell.id] = value
    else delete this._layer._data._overwriteSize[cell.id]
  }
  resetCellSize() {
    this._layer._data._overwriteSize = {}
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
    attribution: 'plugin &copy; <a href="http://www.geog.uni-heidelberg.de/gis">Heidelberg University</a> and <a href="http://www.mocnik-science.net">Franz-Benjamin Mocnik</a>',
    bboxViewPad: 1.05,
    bboxDataPad: 1.25,
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
      this._progress.error('bboxViewPad must be larger than 1')
      this.options.bboxViewPad = 1
    }
    if (this.options.bboxDataPad < 1) {
      this._progress.error('bboxDataPad must be larger than 1')
      this.options.bboxDataPad = 1
    }
    if (this.options.bboxDataPad < this.options.bboxViewPad) {
      this._progress.error('bboxDataPad must be larger or equal than bboxViewPad')
      this.options.bboxDataPad = this.options.bboxViewPad
    }
    this._cellColorScale = null
    this._cellSizeScale = null

    // init progress
    this._progress = new Progress(this.options)

    // init plugins
    this._plugins = []
    this._pluginCallbacks = {}
    this._hoveredCells = []

    // init data
    this._data = new Data(this.options)

    // choose renderer
    if (this.options.renderer.toLowerCase() == 'svg') this._renderer = new RendererSVG(this.options, this._progress, this._data)
    else {
      if (typeof PIXI === 'undefined') this._progress.error('pixi.js needs to be loaded first')
      if (typeof L.pixiOverlay === 'undefined') this._progress.error('Leaflet.PixiOverlay needs to be loaded first')
      this._renderer = new RendererWebGL(this.options, this._progress, this._data)
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
          this._progress.log(d.message)
          break
        case 'progress':
          this._progress.progress(d.percent)
          break
        case 'debugStep':
          this._progress.debugStep(d.title, d.percent)
          break
        case 'debugFinished':
          this._progress.debugFinished()
          break
        case 'resultComputeCells':
          this._data._cells = d.cells
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
    this._renderer.add(map)
    this._updateData()

    // plugins
    this._map.on('mousemove', this._onMouseMove, this)
    this._map.on('mouseout', this._onMouseOut, this)
    this._map.on('click', this._onClick, this)
    
    // events
    this._map.on('viewreset', this._onReset, this)
    this._map.on('zoomend', this._onReset, this)
    this._map.on('moveend', this._onReset, this)
  },
  onRemove: function(map) {
    this._progress.remove()
    this._renderer.remove(map)
    this._webWorker.terminate()
    
    // plugins
    this._map.off('mousemove', this._onMouseMove, this)
    this._map.off('mouseout', this._onMouseOut, this)
    this._map.off('click', this._onClick, this)
    
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
    this._progress.showProgress()
    this._progress.debugStep('download data', 5)
    const b = this._bboxData = this._map.getBounds().pad(this.options.bboxDataPad - 1)
    if (this.options.url) {
      const r = this._resolutionData = this.options.resolution(this._map.getZoom())
      let url = this.options.url
        .replace('{bbox}', b.toBBoxString())
        .replace('{resolution}', r)
      for (const p in this.options.parameters) url = url.replace(`{${p}}`, (this.options.parameters[p] !== null) ? this.options.parameters[p] : '')
      if (this.options.debug || !this.options.silent) this._progress.log(url)
      d3.json(url).then(data => {
        t.options.data = data
        t._processData()
      }).catch(console.debug)
    } else if (this.options.data) this._processData()
  },
  _processData: function() {
    // update scales
    this._data.updateScales()
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
    this._progress.debugStep('produce GeoJSON', 65)
    // produce GeoJSON
    this._data.produceGeoJSON()
    // visualize data
    this._visualizeData()
  },
  _reduceGeoJSON() {
    this._progress.debugStep('reduce GeoJSON for area', 70)
    const b = this._map.getBounds().pad(this.options.bboxViewPad - 1)
    return this._data.reduceGeoJSON(b)
  },
  _visualizeData() {
    const t = this
    const geoJSON = this._data._geoJSON
    // visualize
    if (geoJSON.features.length) {
      // visualize centroids
      if (t._centroids != null) for (let c of t._centroids) c.remove()
      t._centroids = []
      if (t.options.debug) {
        this._progress.debugStep('visualize centroids', 75)
        for (let d of t._data._cells) {
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
    if (this._data._geoJSON === undefined) return
    // reset after zooming, panning, etc.
    if (!this._bboxData.contains(this._data._bboxView) || (this.options.url && this.options.resolution(this._map.getZoom()) !== this._resolutionData)) this._updateData()
    else {
      const geoJSONreduced = this._reduceGeoJSON()
      if (this._data._geoJSON.features.length) this._renderer.update(geoJSONreduced)
    }
  },
  _render() {
    this._renderer.render(this._reduceGeoJSON())
  },
})

L.isea3hLayer = options => new L.ISEA3HLayer(options)
