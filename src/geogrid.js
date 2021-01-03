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
import './geogrid.scss'
import {defaultOptions, defaultOptionsSource, initCore, initOptions} from './geogrid.core.js'
import {Download} from './geogrid.download.js'
import {RendererSVG} from './geogrid.rendererSVG.js'
import {RendererWebGL} from './geogrid.rendererWebGL.js'

/****** PURE FUNCTION ******/
L.isea3hToGeoJSON = (options, callback) => {
  // set options
  options = Object.assign({}, defaultOptions, defaultOptionsSource, options)
  initOptions(options)
  // init core
  initCore(options, d => {}, callback, false)
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
  setCellContourColor(cell, value) {
    if (value) this._layer._data.overwriteContourColor(cell.id, value)
    else this._layer._data.overwriteContourColor(cell.id, null)
  }
  resetCellContourColor() {
    this._layer._data.resetOverwriteContourColor()
  }
  setCellContourWidth(cell, value) {
    if (value) this._layer._data.overwriteContourWidth(cell.id, value)
    else this._layer._data.overwriteContourWidth(cell.id, null)
  }
  resetCellContourWidth() {
    this._layer._data.resetOverwriteContourWidth()
  }
}

/****** LAYER ******/
if (leafletLoaded && d3Loaded) L.ISEA3HLayer = L.Layer.extend({
  options: {...defaultOptions, ...defaultOptionsSource},
  initialize: function(options) {
    this._initialized = false
    this._map = null

    // init options I
    L.Util.setOptions(this, options)
    initOptions(this.options)

    // event listener for web worker
    const eventListener = d => {
      if (this._map) switch (d.task) {
        case 'resultPluginsHover':
          if (d.cell && !this._hoveredCells.map(c => c.idLong).includes(d.cell.idLong)) {
            for (const cell of this._hoveredCells.map(c => c !== undefined && c !== null)) {
              const ePlugin = eventForPlugin(cell)
              if (cell.idLong !== d.cell.idLong) for (let p of this._plugins) if (p.onUnhover !== undefined) p.onUnhover(ePlugin)
            }
            const ePlugin = eventForPlugin(d.cell)
            this._hoveredCells = [d.cell]
            for (let p of this._plugins) if (p.onHover !== undefined) p.onHover(ePlugin)
          }
          break
        case 'resultPluginsClick':
          const ePlugin = eventForPlugin(d.cell)
          for (let p of this._plugins) if (p.onClick !== undefined) p.onClick(ePlugin)
          break
        case 'resultFindNeighbors':
          this._execPluginCallback(d.uid, d.neighbors === null ? null : d.neighbors.map(eventForPlugin))
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
    const eventForPlugin = cell => cell === null || cell === undefined ? null : {
      lat: cell.lat,
      lon: cell.lon,
      cell: cell,
      data: this.options.multipleSources ? this.options.sources.map((source, sourceN) => this._data.dataForId(sourceN, cell.id)) : this._data.dataForId(0, cell.id),
      dataNotMapped: this.options.multipleSources ? this.options.sources.map((source, sourceN) => this._data.dataForIdNotMapped(sourceN, cell.id)) : this._data.dataForIdNotMapped(0, cell.id),
    }
  },
  onAdd: function(map) {
    if (!map) return
    this._map = map
    this._renderer.add(map)
    this._updateData()
    // plugins
    map.on('mousemove', this._onMouseMove, this)
    map.on('mouseout', this._onMouseOut, this)
    map.on('click', this._onClick, this)
    // events
    map.on('viewreset', this._onReset, this)
    map.on('zoomend', this._onReset, this)
    map.on('moveend', this._onReset, this)
  },
  hideFrom: function(map) {
    this._hideOnly = true
    map.removeLayer(this)
    this._hideOnly = false
    return this
  },
  onRemove: function(map) {
    if (!map) return
    this._progress.remove()
    this._renderer.remove(map)
    if (!this._hideOnly) this._webWorker.terminate()
    // plugins
    map.off('mousemove', this._onMouseMove, this)
    map.off('mouseout', this._onMouseOut, this)
    map.off('click', this._onClick, this)
    // events
    map.off('viewreset', this._onReset, this)
    map.off('zoomend', this._onReset, this)
    map.off('moveend', this._onReset, this)
    // map
    this._map = null
  },
  update: function(options) {
    let intensity = {}
    // messages
    const notYetImplemented = o => {
      this._progress.log(`WARNING: update of "${o}" not yet implemented; will re-initialize`)
      intensity.reinitialize = true
    }
    if (options.sources !== undefined) this._process.error('To update the sources, call "updateSources(sources)".  To replace the sources, call "replaceSources(sources)".')
    // check options for sources
    intensity = this._combineUpdateIntensities(intensity, this._determineUpdateSourceIntensity(options))
    // check general options
    if (options.silent !== undefined) notYetImplemented('silent')
    if (options.debug !== undefined) notYetImplemented('debug')
    if (options.cellContourColor !== undefined) intensity.produceGeoJSON = true
    if (options.cellContourWidth !== undefined) intensity.produceGeoJSON = true
    if (options.colorProgressBar !== undefined) notYetImplemented('colorProgressBar')
    if (options.colorDebug !== undefined) notYetImplemented('colorDebug')
    if (options.colorDebugEmphasized !== undefined) notYetImplemented('colorDebugEmphasized')
    if (options.resolution !== undefined) notYetImplemented('resolution')
    if (options.attribution !== undefined) notYetImplemented('attribution')
    if (options.bboxViewPad !== undefined) notYetImplemented('bboxViewPad')
    if (options.bboxDataPad !== undefined) notYetImplemented('bboxDataPad')
    if (options.renderer !== undefined) notYetImplemented('renderer')
    // execute
    this._executeUpdate(intensity, options)
  },
  updateSources: function(sources) {
    let intensity = {}
    // check options for sources
    for (const source of sources) intensity = this._combineUpdateIntensities(intensity, this._determineUpdateSourceIntensity(source))
    // update the sources
    for (let sourceN = 0; sourceN < sources.length; sourceN++) sources[sourceN] = {...this.options.sources[sourceN], ...sources[sourceN]}
    // execute
    this._executeUpdate(intensity, {sources})
  },
  replaceSources: function(sources) {
    this._executeUpdate({reinitialize: true}, {sources})
  },
  _combineUpdateIntensities(intensity1, intensity2) {
    for (const [k, v] of Object.entries(intensity2)) intensity1[k] = intensity1[k] || v
    return intensity1
  },
  _determineUpdateSourceIntensity(o) {
    const intensity = {}
    // messages
    const notYetImplemented = o => {
      this._progress.log(`WARNING: update of "${o}" not yet implemented; will re-initialize`)
      intensity.reinitialize = true
    }
    // check options
    if (o.url !== undefined) intensity.updateData = true
    if (o.data !== undefined) intensity.reinitialize = true
    if (o.parameters !== undefined) intensity.updateData = true
    if (o.tileZoom !== undefined) notYetImplemented('tileZoom')
    if (o.cellColorKey !== undefined) intensity.produceGeoJSON = true
    if (o.cellColorMin !== undefined) intensity.produceGeoJSON = true
    if (o.cellColorMax !== undefined) intensity.produceGeoJSON = true
    if (o.cellColorScale !== undefined) intensity.produceGeoJSON = true
    if (o.cellColorNoData !== undefined) intensity.produceGeoJSON = true
    if (o.cellColorNoKey !== undefined) intensity.produceGeoJSON = true
    if (o.cellColorOpacity !== undefined) intensity.produceGeoJSON = true
    if (o.cellSizeKey !== undefined) intensity.produceGeoJSON = true
    if (o.cellSizeMin !== undefined) intensity.produceGeoJSON = true
    if (o.cellSizeMax !== undefined) intensity.produceGeoJSON = true
    if (o.cellSizeScale !== undefined) intensity.produceGeoJSON = true
    if (o.cellSizeNoData !== undefined) intensity.produceGeoJSON = true
    if (o.cellSizeNoKey !== undefined) intensity.produceGeoJSON = true
    if (o.dataKeys !== undefined) notYetImplemented('dataKeys')
    if (o.dataMap !== undefined) intensity.produceGeoJSON = true
    return intensity
  },
  _executeUpdate(intensity, options) {
    // re-initialize
    if (intensity.reinitialize) {
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
    initOptions(this.options)
    // update data
    if (intensity.updateData) {
      this._updateData()
      return
    }
    // process data
    if (intensity.processData) {
      this._processData()
      return
    }
    // produce GeoJSON
    if (intensity.produceGeoJSON) {
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
  _paddedBounds: function() {
    return this._map.getBounds().pad(this.options.bboxViewPad - 1)
  },
  _updateData: function() {
    const t = this
    // proceed only if data is available
    if ((t.options.sources === null || t.options.sources.length == 0) && t.options.url === null && t.options.data === null) return
    // prepare downloading the data
    t._progress.showProgress()
    t._progress.debugStep(t.options.url !== null ? 'download data' : 'update data', 2.5)
    t._bboxData = this._map.getBounds().pad(this.options.bboxDataPad - 1)
    const resolution = t.options.resolution(t._map.getZoom())
    // download the data
    let n = 0
    const useData = (source, data) => {
      n++
      if (data !== undefined) {
        if (source.dataTransform) data = source.dataTransform(data)
        source.data = data
      }
      if (n == t.options.sources.length) t._processData()
    }
    for (const [sourceN, source] of t.options.sources.entries()) if (source.url !== null && source.url !== undefined) new Download(this.options, source, sourceN, resolution, t._progress).load(t._bboxData, data => {
      t._resolutionData = resolution
      t.fire('dataDownloaded', {data: t.options.multipleSources ? t.options.sources : t.options.sources[0]})
      useData(source, data)
    })
    else useData(source)
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
    if (!t._map) return
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
    t._render()
    // layer has been initialized
    if (!t._initialized) {
      setTimeout(() => {
        t.fire('loadComplete')
      }, 20)
      t._initialized = true
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
