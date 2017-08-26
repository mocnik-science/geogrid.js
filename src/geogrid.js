require('./geogrid.scss')

if (typeof L === 'undefined') throw "geogrid.js needs Leaflet to be loaded first"
if (typeof d3 === 'undefined') throw "geogrid.js needs D3.js to be loaded first"

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
    bboxPad: 1.4,
    colorGridFillData: d3.scaleLinear().domain([0, 3000000]).range(['#fff', '#f00']),
    colorGridFillNoData: '#eee',
    colorGridContour: null,
    widthGridContour: 2,
    colorDebug: '#1e90ff',
    colorDebugEmphasized: '#f00',
    attribution: '&copy; <a href="http://www.uni-heidelberg.de">Heidelberg University</a>',
    renderer: 'webgl',
    debug: false,
    silent: false,
  },
  initialize: function(options) {
    // init options
    L.Util.setOptions(this, options)
    if (this.options.bboxPad < 1) {
      this._error('bboxPad must be larger than 1');
      this.options.bboxPad = 1;
    }
    if (this.options.debug) this.options.silent = false
    if (!this.options.colorGridContour) this.options.colorGridContour = (this.options.debug) ? this.options.colorDebug : '#fff'

    // init progress bar
    this._progressBar = document.createElement('div')
    this._progressBar.id = 'progressBar'
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
  },
  onAdd: function(map) {
    this._map = map
    this._addRender(map)
    this._updateData()
  },
  onRemove: function(map) {
    this.removeRender(map)
  },
  _log: function(message) {
    console.log(`[geogrid.js] ${message}`)
  },
  _error: function(message) {
    throw `[geogrid.js] ${message}`
  },
  _progress: function(percent=100) {
    this._progressBar.style.width = `${percent}%`
    this._progressBar.className = (percent == 0 || percent >= 100) ? 'hidden' : ''
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
      const b = this._dataBounds = this._map.getBounds().pad(this.options.bboxPad)
      const r = this._dataResolution = this.options.resolution(this._map.getZoom())
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
    const t = this

    // handle errors
    if (this.options.data.error) this._error(`data error - ${this.options.data.message}`)

    // save bounds
    this._viewBounds = this._map.getBounds()

    // create cache for neighbours and for vertices
    if (this._cacheNeighbours === undefined) this._cacheNeighbours = {}
    if (this._cacheVertices === undefined) this._cacheVertices = {}

    // make data complete by repetition
    this._debugStep('make data complete by repetition', 10)
    const data = this._data = []
    const minLonN = Math.floor((this._map.getBounds().getWest() + 180) / 360)
    const maxLonN = Math.ceil((this._map.getBounds().getEast() - 180) / 360)
    const west = this._map.getBounds().getWest() - 5
    const east = this._map.getBounds().getEast() + 5
    const repeatNumber = Math.ceil((this._map.getBounds().getEast() - this._map.getBounds().getWest()) / 360)
    const explicitLatLng = this.options.data.data.length > 0 && this.options.data.data[0].lat !== undefined
    for (let i = minLonN; i <= maxLonN; i++) for (let d of this.options.data.data) {
      const isPentagon = d.id.startsWith('-')
      let lon
      let lat
      if (explicitLatLng) {
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
        latLng: L.latLng(lat, lonNew),
        value: d.value,
        lonN: i,
        isPentagon: isPentagon,
        neighbours: this._cacheNeighbours[d.id],
        vertices: this._cacheVertices[d.id],
      })
    }

    // load the data into a tree
    this._debugStep('load data into tree', 15)
    const tree = VPTreeFactory.build(data, (d0, d1) => {
      return d0.latLng.distanceTo(d1.latLng)
    })

    // collect the data needed for a cell
    // in particular: find neighbours for the cells
    this._debugStep('collect the data needed for a cell', 20)
    const cells = {}
    for (let d of data) {
      const numberOfNeighboursToLookFor = d.isPentagon ? 5 : 6
      if (d.neighbours == undefined) {
        d.neighbours = []
        for (let x of tree.search(d, 7 * repeatNumber).splice(1)) {
          const n = data[x.i]
          if (n.id !== d.id && Math.abs(d.latLng.lng - n.latLng.lng) < 180) d.neighbours.push(n.idLong)
          if (d.neighbours.length >= numberOfNeighboursToLookFor) break
        }
      }
      cells[d.idLong] = d
    }

    // filter cells I
    this._debugStep('filter cells I', 40)
    const cellsFiltered = []
    for (let id in cells) {
      const c = cells[id]
      if (c.vertices !== undefined) {
        cellsFiltered.push(c)
        continue
      }
      let numberOfMatchingNeighbours = 0
      for (let id2 of c.neighbours) {
        const c2 = cells[id2]
        if (Math.abs(c2.latLng.lat - c.latLng.lat) > 90 || Math.abs(c2.latLng.lng - c.latLng.lng) > 180) numberOfMatchingNeighbours = -100
        if (c2.neighbours.indexOf(id) >= 0) numberOfMatchingNeighbours++
      }
      if (numberOfMatchingNeighbours >= (c.isPentagon ? 5 : 6)) cellsFiltered.push(c)
    }

    // compute angles and vertices
    this._debugStep('compute angles and vertices', 45)
    for (let c of cellsFiltered) {
      if (c.vertices !== undefined) continue
      // collect neighbours
      const ns = []
      for (let id of c.neighbours) ns.push(cells[id])
      // compute angles
      c.angles = []
      const cLat = c.latLng.lat * Math.PI / 180
      const cLon = c.latLng.lng * Math.PI / 180
      const cosLat = Math.cos(cLat)
      const sinLat = Math.sin(cLat)
      for (let n of ns) {
        const nLat = n.latLng.lat * Math.PI / 180
        const nLon = n.latLng.lng * Math.PI / 180
        const cosNLat = Math.cos(nLat)
        c.angles.push({
          angle: Math.atan2(Math.sin(nLon - cLon) * cosNLat, cosLat * Math.sin(nLat) - sinLat * cosNLat * Math.cos(nLon - cLon)) / Math.PI * 180,
          lat: n.latLng.lat,
          lng: n.latLng.lng,
        })
      }
      // sort by angles
      c.angles.sort((a, b) => (a.angle < b.angle) ? -1 : 1)
      // compute vertices
      c.vertices = []
      for (let i = 0; i <= c.angles.length; i++) {
        const n1 = c.angles[i % c.angles.length]
        const n2 = c.angles[(i + 1) % c.angles.length]
        c.vertices.push([(n1.lng + n2.lng + c.latLng.lng) / 3, (n1.lat + n2.lat + c.latLng.lat) / 3])
      }
    }

    // filter cells II
    this._debugStep('filter cells II', 50)
    const cellsFiltered2 = []
    for (let c of cellsFiltered) {
      if (c.vertices !== undefined) cellsFiltered2.push(c)
      else if (c.isPentagon) cellsFiltered2.push(c)
      else {
        let filter = true
        for (let i = 0; i < 6; i++) {
          const aBefore = Math.abs((c.angles[(i + 2 < 6) ? i + 2 : i - 4].angle - c.angles[i].angle + 360) % 360 - 180)
          const a = Math.abs((c.angles[(i + 3 < 6) ? i + 3 : i - 3].angle - c.angles[i].angle + 360) % 360 - 180)
          const aAfter = Math.abs((c.angles[(i + 4 < 6) ? i + 4 : i - 2].angle - c.angles[i].angle + 360) % 360 - 180)
          if ((aBefore < a) || (aAfter < a)) {
            filter = false
            break
          }
        }
        if (filter) cellsFiltered2.push(c)
      }
    }

    // cache neighbours
    this._debugStep('cache neighbours', 55)
    for (let c of cellsFiltered2) this._cacheNeighbours[c.id] = c.neighbours

    // cache vertices
    this._debugStep('cache vertices', 57.5)
    for (let c of cellsFiltered2) this._cacheVertices[c.id] = c.vertices

    // produce GeoJSON
    this._debugStep('produce GeoJSON', 60)
    const features = []
    for (let c of cellsFiltered2) {
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
    this._geoJSON = {
      type: 'FeatureCollection',
      features: features,
    }

    // visualize
    this._visualizeData()
    this._debugFinished()
  },
  _visualizeData: function() {
    const t = this
    const geoJSON = this._geoJSON
    // visualize
    if (geoJSON.features.length) {
      // visualize centers
      if (t._centers != null) for (let c of t._centers) c.remove()
      t._centers = []
      if (t.options.debug) for (let d of t._data) {
        const circle = L.circle(d.latLng, {color: (d.isPentagon) ? t.options.colorDebugEmphasized : t.options.colorDebug, fill: (d.isPentagon) ? t.options.colorDebugEmphasized : t.options.colorDebug, radius: 3}).on('mouseover', e => console.debug(e.target._d)).addTo(t._map)
        circle._d = d
        t._centers.push(circle)
      }
      // visualize cells
      t._renderRender(geoJSON)
    }
    // reset after zooming, etc.
    const reset = () => {
      if (geoJSON.features.length) t._updateRender(geoJSON)
      if ((!t._dataBounds.contains(t._map.getBounds())) || (t.options.resolution(t._map.getZoom()) !== t._dataResolution)) t._updateData()
      else if (!this._viewBounds.contains(t._map.getBounds())) t._processData()
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
      t._debugStep(`visualize (${(renderer instanceof PIXI.CanvasRenderer) ? 'Canvas' : 'WebGL'})`, 80)
      // collect utils
      const zoom = utils.getMap().getZoom()
      const container = utils.getContainer()
      const project = utils.latLngToLayerPoint
      const scale = utils.getScale()
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
