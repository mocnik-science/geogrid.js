"use strict"

/****** DATA ******/
module.exports.Data = class Data {
  constructor(options) {
    this._options = options
    this._dataById = null
    this._cells = []
    this._geoJSON = null
    
    // init plugins
    this._overwriteColor = {}
    this._overwriteSize = {}
  }
  // replaces Math.min(...xs) but also works for very large array
  _min(xs) {
    let len = xs.length
    let min = Infinity
    while (len--) if (xs[len] < min) min = xs[len]
    return min
  }
  // replaces Math.max(...xs) but also works for very large array
  _max(xs) {
    let len = xs.length
    let max = -Infinity
    while (len--) if (xs[len] > max) max = xs[len]
    return max
  }
  getCells() {
    return this._cells
  }
  setCells(cells) {
    this._cells = cells
  }
  getGeoJSON() {
    return this._geoJSON
  }
  updateScales() {
    if (!this._options.data || !this._options.data.data) return
    const t = this
    const computeScale = (scale, min, max, value) => {
      if (value == null) return null
      if (scale.length != 2) return scale
      let values
      if (!min || !max) {
        values = Object.values(t._options.data.data).map(x => x[value]).filter(x => x !== null)
        if (values.length == 0) values = [0]
      }
      const minComputed = (min) ? min : this._min(values)
      const maxComputed = (max) ? max : this._max(values)
      return scale(minComputed, maxComputed)
    }
    this._cellColorScale = computeScale(this._options.cellColorScale, this._options.cellColorMin, this._options.cellColorMax, this._options.cellColorKey)
    this._cellSizeScale = computeScale(this._options.cellSizeScale, this._options.cellSizeMin, this._options.cellSizeMax, this._options.cellSizeKey)
  }
  getOverwriteColor() {
    return this._overwriteColor
  }
  getOverwriteSize() {
    return this._overwriteSize
  }
  overwriteColor(id, color) {
    if (color !== null) this._overwriteColor[id] = color
    else delete this._overwriteColor[cell.id]
  }
  overwriteSize(id, size) {
    if (size !== null) this._overwriteSize[id] = size
    else delete this._overwriteSize[cell.id]
  }
  resetOverwriteColor() {
    this._overwriteColor = {}
  }
  resetOverwriteSize() {
    this._overwriteSize = {}
  }
  cellColor(id, properties) {
    // return overwritten colour
    if (id in this._overwriteColor) return this._overwriteColor[id]
    // no key
    if (this._options.cellColorKey == null) return this._options.cellColorNoKey
    // compute value
    const value = properties[this._options.cellColorKey]
    // return if empty value
    if (value == null) return this._options.cellColorNoData
    // return if no scale
    if (this._cellColorScale == null) return this._options.cellColorNoKey
    // compute colour
    return this._cellColorScale(value)
  }
  cellSize(id, properties, geometry) {
    let relativeSize
    // choose overwritten relative size
    if (id in this._overwriteSize) relativeSize = this._overwriteSize[id]
    // no key
    else if (this._options.cellSizeKey == null) relativeSize = this._options.cellSizeNoKey
    else {
      // compute value
      const value = properties[this._options.cellSizeKey]
      // empty value
      if (value == null) relativeSize = this._options.cellSizeNoData
      // no scale
      else if (this._cellSizeScale == null) relativeSize = this._options.cellSizeNoKey
      // compute relative size
      else relativeSize = this._cellSizeScale(value)
    }
    // if no resize needed, return geometry
    if (relativeSize == 1) return geometry
    // resize geometry
    const centroid = geometry.reduce(([x0, y0], [x1, y1]) => [x0 + x1, y0 + y1]).map(c => c / geometry.length)
    return geometry.map(([x, y]) => [relativeSize * (x - centroid[0]) + centroid[0], relativeSize * (y - centroid[1]) + centroid[1]])
  }
  cacheData() {
    if (this._options.data === null) return null
    this._dataById = new Map()
    const ds = this._options.data.data
    this._options.data.data = new Array(ds.length)
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      this._dataById.set(d.id, d)
      if (d.lat !== undefined) {
        this._options.data.data[i] = {
          id: d.id,
          lat: d.lat,
          lon: d.lon,
        }
        if (d.isPentagon !== undefined) this._options.data.data[i].isPentagon = d.isPentagon
      }
      this._options.data.data[i] = d.id
    }
    const json = this._options.data
    this._options.data = null
    return json
  }
  produceGeoJSON() {
    const keysToCopy = (this._cells.length > 0) ? Object.keys(this._dataById.get(this._cells[0].id)).filter(k => !['id', 'lat', 'lon', 'isPentagon'].includes(k)) : []
    const features = []
    for (let c of this._cells) {
      if (c.vertices !== undefined) {
        const properties = {}
        const d = this._dataById.get(c.id)
        for (const k of keysToCopy) properties[k] = d[k]
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
  }
  dataForId(id) {
    const keysToCopy = (this._cells.length > 0) ? Object.keys(this._dataById.get(this._cells[0].id)).filter(k => !['id', 'lat', 'lon', 'isPentagon'].includes(k)) : []
    const d = this._dataById.get(id)
    if (d === undefined) return {}
    const properties = {}
    for (const k of keysToCopy) properties[k] = d[k]
    return properties
  }
  reduceGeoJSON(b) {
    if (!this._geoJSON) return
    // return cached GeoJSON in case of unchanged bounds
    if (b.equals(this._bboxView)) return this._geoJSONreduced
    this._bboxView = b
    // reduce
    this._geoJSONreduced = {
      type: 'FeatureCollection',
      features: [],
    }
    for (let f of this._geoJSON.features) if (b.intersects(L.latLngBounds(f.geometry.coordinates[0].map(c => [c[1], c[0]])))) this._geoJSONreduced.features.push(f)
    // return
    return this._geoJSONreduced
  }
}
