"use strict"

/****** RENDERER SVG ******/
module.exports.RendererSVG = class RendererSVG {
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
    this._visHexagons = this._g.selectAll('path')
      .data(geoJSON.features)
      .enter().append('path')
        .attr('fill', feature => t._data.cellColor(feature.properties.id, feature.properties))
        .attr('stroke', t._options.cellContourColor)
        .attr('stroke-width', t._options.cellContourWidth)
        .attr('opacity', this._options.cellColorOpacity)
    this.update(geoJSON)
  }
  update(geoJSON) {
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
          t._data.cellSize(feature.properties.id, feature.properties, feature.geometry.coordinates[0]),
        ],
      },
      properties: feature.properties,
    }))
    this._progress.debugFinished()
  }
}
