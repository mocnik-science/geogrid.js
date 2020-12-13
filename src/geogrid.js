"use strict"

/****** CHECK EXTERNAL LIBRARIES LOADED ******/
const leafletLoaded = typeof L !== 'undefined'
const d3Loaded = typeof d3 !== 'undefined'
if (!leafletLoaded) {
  console.log('[geogrid.js] Leaflet needs to be loaded first / only pure functions available')
  window.L = {}
}
if (!d3Loaded) console.log('[geogrid.js] D3.js needs to be loaded first / only pure functions available')

/****** IMPORTS ******/
let RendererWebGL
let RendererSVG
if (leafletLoaded && d3Loaded) {
  require('./geogrid.scss')
  RendererWebGL = require('./geogrid.rendererWebGL.js').RendererWebGL
  RendererSVG = require('./geogrid.rendererSVG.js').RendererSVG  
}
const defaultOptions = require('./geogrid.core.js').defaultOptions
const initCore = require('./geogrid.core.js').initCore

/****** PURE FUNCTION ******/
L.isea3hToGeoJSON = (options, callback) => {
  // set options
  options = Object.assign({}, () => {}, defaultOptions, options)

  // init core
  const {_processDataInWebWorker} = initCore(options, d => {}, callback, false)

  // process
  _processDataInWebWorker()
}

/****** PLUGIN ******/
if (leafletLoaded && d3Loaded) L.ISEA3HLayerPlugin = class ISEA3HLayerPlugin {
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
    if (value) this._layer._data.overwriteColor(cell.id, value)
    else this._layer._data.overwriteColor(cell.id, null)
  }
  resetCellColor() {
    this._layer._data.resetOverwriteColor()
  }
  setCellSize(cell, value) {
    if (value) this._layer._data.overwriteSize(cell.id, value)
    else this._layer._data.overwriteSize(cell.id, null)
  }
  resetCellSize() {
    this._layer._data.resetOverwriteSize()
  }
}

/****** LAYER ******/
if (leafletLoaded && d3Loaded) L.ISEA3HLayer = L.Layer.extend({
  options: defaultOptions,
  initialize: function(options) {
    this._initialized = false
    this._map = null

    // init options I
    L.Util.setOptions(this, options)

    // event listener for web worker
    const eventListener = d => {
      if (this._map) switch (d.task) {
        case 'resultPluginsHover':
          if (!this._hoveredCells.map(c => c.idLong).includes(d.cell.idLong)) {
            for (const cell of this._hoveredCells) {
              const ePlugin = eventForPlugin(cell)
              if (cell.idLong !== d.cell.idLong) for (let p of this._plugins) if (p.onUnhover !== undefined) p.onUnhover(ePlugin)
            }
            const ePlugin = eventForPlugin(d.cell)
            this._hoveredCells = [d.cell]
            for (let p of this._plugins) if (p.onHover !== undefined) p.onHover(ePlugin)
          }
          break
        case 'resultPluginsClick':
          const ePlugin = eventForPlugin(d)
          for (let p of this._plugins) if (p.onClick !== undefined) p.onClick(ePlugin)
          break
        case 'resultFindNeighbors':
          this._execPluginCallback(d.uid, d.neighbors.map(cell => eventForPlugin(cell)))
          break
      }
    }

    // init the core
    const core = initCore(this.options, eventListener, () => this._visualizeData(), true)
    this.options = core.options
    this._progress = core._progress
    this._data = core._data
    this._webWorker = core._webWorker
    this._processDataInWebWorker = core._processDataInWebWorker
    this._webWorkerPostMessage = core._webWorkerPostMessage

    // init plugins
    if (this._plugins === undefined) this._plugins = []
    if (this._pluginCallbacks === undefined) this._pluginCallbacks = {}
    this._hoveredCells = []

    // choose renderer
    if (this.options.renderer.toLowerCase() == 'svg') this._renderer = new RendererSVG(this.options, this._progress, this._data)
    else {
      if (typeof PIXI === 'undefined') this._progress.error('pixi.js needs to be loaded first')
      if (typeof L.pixiOverlay === 'undefined') this._progress.error('Leaflet.PixiOverlay needs to be loaded first')
      this._renderer = new RendererWebGL(this.options, this._progress, this._data)
    }

    // event for plugin
    const t = this
    const eventForPlugin = cell => ({
      lat: cell.lat,
      lon: cell.lon,
      cell: cell,
      data: this._data.dataForId(cell.id),
      ...(this.options.dataMap !== null ? {dataNotMapped: this._data.dataForIdNotMapped(cell.id)} : {}),
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

    this._map = null
  },
  update: function(options) {
    let reinitialize = false
    let updateData = false
    let processData = false
    let produceGeoJSON = false
    // messages
    const notYetImplemented = o => {
      console.log(`[WARNING] update of "${o}" not yet implemented; will re-initialize`)
      reinitialize = true
    }
    // check options
    if (options.url != undefined) updateData = true
    if (options.data != undefined) reinitialize = true
    if (options.silent != undefined) notYetImplemented('silent')
    if (options.debug != undefined) notYetImplemented('debug')
    if (options.resolution != undefined) notYetImplemented('resolution')
    if (options.parameters != undefined) updateData = true
    if (options.cellColorKey != undefined) produceGeoJSON = true
    if (options.cellColorMin != undefined) produceGeoJSON = true
    if (options.cellColorMax != undefined) produceGeoJSON = true
    if (options.cellColorScale != undefined) produceGeoJSON = true
    if (options.cellColorNoData != undefined) produceGeoJSON = true
    if (options.cellColorNoKey != undefined) produceGeoJSON = true
    if (options.cellColorOpacity != undefined) produceGeoJSON = true
    if (options.cellSizeKey != undefined) produceGeoJSON = true
    if (options.cellSizeMin != undefined) produceGeoJSON = true
    if (options.cellSizeMax != undefined) produceGeoJSON = true
    if (options.cellSizeScale != undefined) produceGeoJSON = true
    if (options.cellSizeNoData != undefined) produceGeoJSON = true
    if (options.cellSizeNoKey != undefined) produceGeoJSON = true
    if (options.cellContourColor != undefined) produceGeoJSON = true
    if (options.cellContourWidth != undefined) produceGeoJSON = true
    if (options.colorProgressBar != undefined) notYetImplemented('colorProgressBar')
    if (options.colorDebug != undefined) notYetImplemented('colorDebug')
    if (options.colorDebugEmphasized != undefined) notYetImplemented('colorDebugEmphasized')
    if (options.dataKeys != undefined) notYetImplemented('dataKeys')
    if (options.dataMap != undefined) produceGeoJSON = true
    if (options.attribution != undefined) notYetImplemented('attribution')
    if (options.bboxViewPad != undefined) notYetImplemented('bboxViewPad')
    if (options.bboxDataPad != undefined) notYetImplemented('bboxDataPad')
    if (options.renderer != undefined) notYetImplemented('renderer')
    if (options.urlLibs != undefined) notYetImplemented('urlLibs')
    // re-initialize
    if (reinitialize) {
      const map = this._map
      this.onRemove(this._map)
      this.initialize({
        ...this.options,
        ...options,
      })
      this.onAdd(map)
      return
    }
    // copy options
    for (const k in options) this.options[k] = options[k]
    // update data
    if (updateData) {
      this._updateData()
      return
    }
    // process data
    if (processData) {
      this._processData()
      return
    }
    // produce GeoJSON
    if (produceGeoJSON) {
      this._data.produceGeoJSON()
      this._visualizeData()
      return
    }
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
    this._webWorkerPostMessage({
      task: 'findNeighbors',
      taskResult: 'resultFindNeighbors',
      uid: this._storePluginCallback(callback),
      idLong: cell.idLong,
    })
  },
  _paddedBounds() {
    return this._map.getBounds().pad(this.options.bboxViewPad - 1)
  },
  _updateData: function() {
    const t = this
    // proceed only if data is available
    if (this.options.data === null) return
    // download the data
    this._progress.showProgress()
    this._progress.debugStep('download data', 2.5)
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
    } else this._processData()
  },
  _processData: function() {
    // process data in web worker
    this._processDataInWebWorker({
      north: this._bboxData.getNorth(),
      south: this._bboxData.getSouth(),
      west: this._bboxData.getWest(),
      east: this._bboxData.getEast(),
    })
  },
  _reduceGeoJSON: function() {
    this._progress.debugStep('reduce GeoJSON for area', 70)
    return this._data.reduceGeoJSON(this._paddedBounds())
  },
  _visualizeData: function() {
    const t = this
    const geoJSON = this._data.getGeoJSON()
    // visualize
    if (geoJSON.features.length) {
      // visualize centroids
      if (t._centroids != null) for (let c of t._centroids) c.remove()
      t._centroids = []
      if (t.options.debug) {
        this._progress.debugStep('visualize centroids', 75)
        for (let d of t._data.getCells()) {
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
    if (!this._initialized) {
      this.fire('loadComplete')
      this._initialized = true
    }
  },
  _onMouseMove: function(e) {
    if (this._pluginsOnHover && this._initialized) this._webWorkerPostMessage({
      task: 'findCell',
      taskResult: 'resultPluginsHover',
      lat: e.latlng.lat,
      lon: e.latlng.lng,
    })
  },
  _onMouseOut: function(e) {
    if (this._hoveredCells === undefined) return
    for (const cell of this._hoveredCells) {
      const ePlugin = {
        cell: cell,
      }
      for (let p of this._plugins) if (p.onUnhover !== undefined) p.onUnhover(ePlugin)
    }
    this._hoveredCells = []
  },
  _onClick: function(e) {
    if (this._pluginsOnHover && this._initialized) this._webWorkerPostMessage({
      task: 'findCell',
      taskResult: 'resultPluginsClick',
      lat: e.latlng.lat,
      lon: e.latlng.lng,
    })
  },
  _onReset: function(e) {
    if (this._data.getGeoJSON() === null || this._data.getGeoJSON() === undefined) return
    // reset after zooming, panning, etc.
    if ((this._paddedBounds && !this._bboxData.contains(this._paddedBounds())) || (this.options.url && this.options.resolution(this._map.getZoom()) !== this._resolutionData)) this._updateData()
    else {
      const geoJSONreduced = this._reduceGeoJSON()
      if (geoJSONreduced && geoJSONreduced.features.length) this._renderer.render(geoJSONreduced)
    }
  },
  _render: function() {
    this._renderer.render(this._reduceGeoJSON())
  },
})

if (leafletLoaded && d3Loaded) L.isea3hLayer = options => new L.ISEA3HLayer(options)
