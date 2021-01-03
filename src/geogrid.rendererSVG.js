"use strict"

/****** RENDERER SVG ******/
export class RendererSVG {
  constructor(options, progress, data) {
    this._options = options
    this._progress = progress
    this._data = data
  }
  add(map) {
    this._map = map
    this._svg = d3.select(this._map.getPanes().overlayPane).append('svg').attr('position', 'relative')
    this._g = this._svg.append('g').attr('class', 'leaflet-zoom-hide')
  }
  remove(map) {
    this._svg.remove()
  }
  render(geoJSON) {
    this._progress.debugStep('visualize (SVG)', 80)
    const t = this
    this._g.selectAll('path').remove()
    for (const feature of geoJSON.features) {
      feature._overwritten = t._data.cellContourColor(feature.properties.id, true) !== null || t._data.cellContourWidth(feature.properties.id, true) !== null
    }
    this._visHexagons = this._g.selectAll('path')
      .data(geoJSON.features)
      .enter().append('path')
        .sort((f1, f2) => d3.ascending(f1._overwritten, f2._overwritten))
        .attr('fill', feature => feature.properties._isCell ? 'none' : t._data.cellColor(feature.properties._sourceN, feature.properties.id, feature.properties))
        .attr('stroke', feature => feature.properties._isCell ? t._data.cellContourColor(feature.properties.id) : null)
        .attr('stroke-width', feature => feature.properties._isCell ? t._data.cellContourWidth(feature.properties.id) : null)
        .attr('stroke-opacity', feature => feature.properties._isCell ? t._options.cellContourOpacity : null)
        .attr('opacity', this._options.cellColorOpacity)
    this._update(geoJSON)
  }
  _update(geoJSON) {
    this._progress.debugStep('visualize - update (SVG))', 90)
    const t = this
    const projectPoint = function(x, y) {
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
          feature.properties._isCell ? feature.geometry.coordinates[0] : t._data.cellSize(feature.properties._sourceN, feature.properties.id, feature.properties, feature.geometry.coordinates[0]),
        ],
      },
      properties: feature.properties,
    }))
    this._progress.debugFinished()
  }
}
