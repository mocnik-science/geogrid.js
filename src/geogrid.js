"use strict"

require('./geogrid.scss')

if (typeof L === 'undefined') throw '[geogrid.js] Leaflet needs to be loaded first'
if (typeof d3 === 'undefined') throw '[geogrid.js] D3.js needs to be loaded first'

/****** LAYER ******/
L.ISEA3HLayer = L.Layer.extend({
  options: {
    data: null,
    url: null,
    opacityGridFill: .5,
    resolution: s => {
      if (s <= 3) return 4
      if (s <= 5) return 6
      if (s <= 6) return 8
      if (s <= 9) return 12
      return 14
    },
    bboxViewPad: 1.1,
    bboxDataPad: 1.4,
    colorGridFillData: d3.scaleLinear().domain([0, 3000000]).range(['#fff', '#f00']),
    colorGridFillNoData: '#eee',
    colorGridContour: null,
    widthGridContour: 2,
    colorProgressBar: '#ff5151',
    colorDebug: '#1e90ff',
    colorDebugEmphasized: '#f00',
    attribution: '&copy; <a href="http://www.uni-heidelberg.de">Heidelberg University</a>',
    renderer: 'webgl',
    debug: false,
    silent: true,
  },
  initialize: function(options) {
    // init options
    L.Util.setOptions(this, options)
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
    if (this.options.debug) this.options.silent = false
    if (!this.options.colorGridContour) this.options.colorGridContour = (this.options.debug) ? this.options.colorDebug : '#fff'

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
      this._removeAdd = this._removeSVG
      this._renderRender = this._renderSVG
      this._updateRender = this._updateSVG
    } else {
      if (typeof PIXI === 'undefined') this._error('pixi.js needs to be loaded first')
      if (typeof L.pixiOverlay === 'undefined') this._error('Leaflet.PixiOverlay needs to be loaded first')
      this._addRender = this._addWebGL
      this._removeAdd = this._removeWebGL
      this._renderRender = this._renderWebGL
      this._updateRender = this._updateWebGL
    }

    // create web worker
    let url = document.location.href.split('/')
    url = url.splice(0, url.length - 1).join('/') + '/'
    const workerFunctionString = `(${isea3hWorker.toString()})()`.replace('importScripts(\'./vptree.js/vptree.min.js\')', `importScripts('${url}libs/vptree.js/vptree.min.js')`)
    this._webWorker = new Worker(URL.createObjectURL(new Blob([workerFunctionString])))
    this._webWorker.addEventListener('message', e => {
      const d = e.data
      switch (d.task) {
        case 'log':
          this._log(d.message)
          break
        case 'error':
          this._error(d.message)
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
      }
    })
  },
  onAdd: function(map) {
    this._map = map
    this._addRender(map)
    this._updateData()
  },
  onRemove: function(map) {
    this.removeRender(map)
    this._webWorker.terminate()
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
  _debugStep: function(title, percent=null) {
    if (percent !== null) this._progress(percent)
    if (!this.options.silent) {
      const t = (new Date()).getTime()
      if (this._debugTimestamp != null && this._debugTitle != null) this._log(this._debugTitle + ' (' + (t - this._debugTimestamp) + 'ms)')
      this._debugTimestamp = t
      this._debugTitle = title
    }
  },
  _debugFinished: function() {
    this._progress(100)
    if (!this.options.silent) {
      if (this._debugTimestamp != null && this._debugTitle != null) this._log(this._debugTitle + ' (' + ((new Date()).getTime() - this._debugTimestamp) + 'ms)')
      this._debugTimestamp = null
      this._debugTitle = null
    }
  },
  _updateData: function() {
    const t = this

    // download the data
    this._debugStep('download data', 5)
    if (this.options.url) {
      const b = this._bboxData = this._map.getBounds().pad(this.options.bboxDataPad)
      const r = this._resolutionData = this.options.resolution(this._map.getZoom())
      const url = this.options.url
        .replace('{bbox}', b.toBBoxString())
        .replace('{resolution}', r)
      if (this.options.debug) this._log(url)
      d3.json(url, data => {
        t.options.data = data
        t._processData()
      })
    } else if (this.options.data) this._processData()
  },
  _processData: function() {
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
    for (let c of this._cells) {
      if (c.vertices !== undefined) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [c.vertices],
          },
          properties: {
            value: c.value,
          },
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
          const circle = L.circle([d.lat, d.lon], {color: (d.isPentagon) ? t.options.colorDebugEmphasized : t.options.colorDebug, fill: (d.isPentagon) ? t.options.colorDebugEmphasized : t.options.colorDebug, radius: 3}).on('mouseover', e => console.debug(e.target._d)).addTo(t._map)
          circle._d = d
          t._centroids.push(circle)
        }
      }
      // visualize cells
      this._renderRender(this._reduceGeoJSON())
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
    const projectPoint = (x, y) => {
      const point = t._map.latLngToLayerPoint(L.latLng(y, x))
      this.stream.point(point.x, point.y)
    }
    const transform = d3.geoTransform({point: projectPoint})
    const path = d3.geoPath(transform)
    this._g.selectAll('path').remove()
    this._visHexagons = this._g.selectAll('path')
      .data(geoJSON.features)
      .enter().append('path')
        .attr('fill', feature => (feature.properties.value === null) ? t.options.colorGridFillNoData : t.options.colorGridFillData(feature.properties.value))
        .attr('stroke', t.options.colorGridContour)
        .attr('stroke-width', t.options.widthGridContour)
        .attr('opacity', this.options.opacityGridFill)
    this._debugFinished()
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
      .style('left', bounds[0][0] + 'px')
      .style('top', bounds[0][1] + 'px')
    this._g.attr('transform', 'translate(' + -bounds[0][0] + ',' + -bounds[0][1] + ')')
    this._visHexagons.attr('d', path)
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
      setTimeout(() => {
        // colors
        const colorGridContour = pixiColor(t.options.colorGridContour)
        const colorGridFillNoData = pixiColor(t.options.colorGridFillNoData)
        const colorGridFillData = value => (value) ? pixiColor(t.options.colorGridFillData(value)) : colorGridFillNoData
        // if new geoJSON, cleanup and initialize
        if (t._geoJSON._webgl_initialized == null || prevZoom != zoom) {
          t._geoJSON._webgl_initialized = true
          pixiGraphics.clear()
        }
        // draw geoJSON features
        for (let h of t._geoJSON.features) {
          const notInitialized = (h._webgl_coordinates == null)
          if (notInitialized) h._webgl_coordinates = h.geometry.coordinates[0].map(c => project([c[1], c[0]]))
          if (notInitialized || prevZoom != zoom) {
            pixiGraphics.lineStyle(t.options.widthGridContour / scale, colorGridContour, 1)
            pixiGraphics.beginFill(colorGridFillData(h.properties.value), t.options.opacityGridFill)
            pixiGraphics.drawPolygon([].concat(...h._webgl_coordinates.map(c => [c.x, c.y])))
            pixiGraphics.endFill()
          }
        }
        prevZoom = zoom
        renderer.render(container)
        t._debugFinished()
      }, 1)
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
  const error = message => postMessage({task: 'error', message: message})
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
    }
  }

  // constants
  const rad = Math.PI / 180
  const radCircle = 2 * Math.PI

  // caches
  let cacheNeighbours = {}
  let cacheVertices = {}

  // compute GeoJSON
  const computeGeoJSON = (json, bbox) => {
    // handle errors
    if (json.error) error(`data error - ${json.message}`)

    // make data complete by repetition
    debugStep('make data complete by repetition', 10)
    const data = []
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
        if (idWithoutSign.length < 19) idWithoutSign = '0' + idWithoutSign
        lat = parseInt(idWithoutSign.substr(2, 8)) / 1e6
        lon = parseInt(idWithoutSign.substr(10)) / 1e6
        const partB = parseInt(idWithoutSign.substr(0, 2))
        if ((partB >= 20 && partB < 40) || partB >= 60) lat *= -1
        if (partB >= 40) lon *= -1
      }
      const lonNew = lon + i * 360
      if (west <= lonNew && lonNew <= east) data.push({
        id: d.id,
        idLong: d.id + "_" + i,
        lat: lat,
        lon: lonNew,
        sinLat: Math.sin(lat * rad),
        cosLat: Math.cos(lat * rad),
        value: d.value,
        lonN: i,
        isPentagon: isPentagon,
        neighbours: cacheNeighbours[d.id],
        vertices: cacheVertices[d.id],
      })
    }

    // load the data into a tree
    debugStep('load data into tree', 15)
    const tree = VPTreeFactory.build(data, (d0, d1) => {
      return Math.acos(Math.min(d0.sinLat * d1.sinLat + d0.cosLat * d1.cosLat * Math.cos((d1.lon - d0.lon) * rad), 1))
    })

    // collect the data needed for a cell
    // in particular: find neighbours for the cells
    debugStep('collect the data needed for a cell', 20)
    const cells = {}
    for (let d of data) {
      const numberOfNeighboursToLookFor = d.isPentagon ? 5 : 6
      if (d.neighbours == undefined) {
        d.neighbours = []
        for (let x of tree.search(d, 7 * repeatNumber).splice(1)) {
          const n = data[x.i]
          if (n.id !== d.id && Math.abs(d.lon - n.lon) < 180) d.neighbours.push(n.idLong)
          if (d.neighbours.length >= numberOfNeighboursToLookFor) break
        }
      }
      cells[d.idLong] = d
    }

    // filter cells I
    // filter cells by location of neighbours
    debugStep('filter cells I', 40)
    for (let id in cells) {
      const c = cells[id]
      if (c.vertices !== undefined) continue
      let numberOfMatchingNeighbours = 0
      for (let id2 of c.neighbours) {
        const c2 = cells[id2]
        if (Math.abs(c2.lat - c.lat) > 90 || Math.abs(c2.lon - c.lon) > 180) numberOfMatchingNeighbours = -100
        if (c2.neighbours.indexOf(id) >= 0) numberOfMatchingNeighbours++
      }
      if (numberOfMatchingNeighbours >= (c.isPentagon ? 5 : 6)) continue
      c.filtered = false
    }

    // compute angles and vertices
    debugStep('compute angles and vertices', 45)
    for (let id in cells) {
      const c = cells[id]
      if (c.filtered === false || c.vertices !== undefined) continue
      c.angles = []
      // compute angles
      for (let id2 of c.neighbours) {
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
    for (let id in cells) cacheNeighbours[id] = cells[id].neighbours

    // cache vertices
    debugStep('cache vertices', 57.5)
    for (let id in cells) cacheVertices[id] = cells[id].vertices

    // clean up data about cells
    debugStep('clean up data about cells', 60)
    const cells2 = new Array(cells.length)
    let i = -1
    for (let id in cells) {
      i++
      const c = cells[id]
      cells2[i] = {
        lat: c.lat,
        lon: c.lon,
        isPentagon: c.isPentagon,
      }
      if (c.filtered !== false) {
        cells2[i].vertices = c.vertices
        cells2[i].value = c.value
      }
    }

    return cells2
  }
}
