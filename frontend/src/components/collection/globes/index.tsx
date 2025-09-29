// components/Globe/index.tsx

import React, { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import * as d3 from 'd3';
import CoreGlobe from './CoreGlobe';
import Popups from './Popups';
import MapLegend from '../unsorted/MapLegend';

interface GlobeProps {
  onLocationClick: (countryName: string) => void;
}

const Globe = (
  {
    ref,
    onLocationClick
  }
) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Extensive graph data with three networks
  const graphData = {
    nodes: [
      { id: 'Politics1', coordinates: [13.4050, 52.5200], group: 1, topic: 'Politics', title: 'Election Results', summary: 'Summary of the recent election results.', date: '2023-10-01' },
      { id: 'Economy1', coordinates: [2.3522, 48.8566], group: 2, topic: 'Economy', title: 'Market Trends', summary: 'Analysis of current market trends.', date: '2023-10-02' },
      { id: 'Tech1', coordinates: [11.5820, 48.1351], group: 3, topic: 'Technology', title: 'AI Innovations', summary: 'Latest innovations in AI technology.', date: '2023-10-03' },
      // Add more articles for each network
    ],
    links: [
      { source: 'Politics1', target: 'Economy1' },
      { source: 'Tech1', target: 'Politics1' },
      // Add more links to represent relationships
    ],
  };

  useEffect(() => {
    // Wait for the map to initialize
    const interval = setInterval(() => {
      if (mapRef.current) {
        clearInterval(interval);
        initializeD3Overlay(mapRef.current);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  const initializeD3Overlay = (map: mapboxgl.Map) => {
    const container = map.getCanvasContainer();
    const width = map.getCanvas().width;
    const height = map.getCanvas().height;

    // Create an SVG element and append it to the map container
    const svg = d3
      .select(container)
      .append('svg')
      .attr('class', 'd3-overlay')
      .attr('width', width)
      .attr('height', height);

    drawGraph(map, svg, graphData);

    // Update positions on map movements
    map.on('move', () => updateGraph(map, svg, graphData));
    map.on('moveend', () => updateGraph(map, svg, graphData));
    map.on('zoom', () => updateGraph(map, svg, graphData));
    map.on('resize', () => {
      const width = map.getCanvas().width;
      const height = map.getCanvas().height;
      svg.attr('width', width).attr('height', height);
      updateGraph(map, svg, graphData);
    });
  };

  const drawGraph = (
    map: mapboxgl.Map,
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    data: typeof graphData
  ) => {
    // Projection function to convert geo coordinates to pixel positions
    const project = (lngLat: [number, number]) => {
      const point = map.project(new mapboxgl.LngLat(lngLat[0], lngLat[1]));
      return [point.x, point.y];
    };

    // Draw nodes (articles) with different colors for each network
    svg
      .selectAll('.node')
      .data(data.nodes)
      .enter()
      .append('circle')
      .attr('class', 'node')
      .attr('r', 6)
      .attr('fill', (d) => {
        switch (d.group) {
          case 1: return '#e74c3c'; // Politics
          case 2: return '#3498db'; // Economy
          case 3: return '#2ecc71'; // Technology
          default: return '#888';
        }
      })
      .on('mouseover', function (event, d) {
        d3.select(this).attr('fill', '#ff0');
        // Trigger popup with detailed article information
        const popupContent = `
          <h3>${d.title}</h3>
          <p><strong>Topic:</strong> ${d.topic}</p>
          <p><strong>Summary:</strong> ${d.summary}</p>
          <p><strong>Date:</strong> ${d.date}</p>
        `;
        new mapboxgl.Popup()
          .setLngLat(map.unproject([event.pageX, event.pageY]))
          .setHTML(popupContent)
          .addTo(map);
      })
      .on('mouseout', function (d) {
        d3.select(this).attr('fill', (d) => {
          switch (d.group) {
            case 1: return '#e74c3c';
            case 2: return '#3498db';
            case 3: return '#2ecc71';
            default: return '#888';
          }
        });
      })
      .on('click', function (d) {
        // Open detailed view or external link
        window.open(`https://news.example.com/articles/${d.id}`, '_blank');
      });

    // Draw links (edges) with different styles
    svg
      .selectAll('.link')
      .data(data.links)
      .enter()
      .append('line')
      .attr('class', 'link')
      .attr('stroke', '#888')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => {
        const sourceNode = data.nodes.find((n) => n.id === d.source);
        const targetNode = data.nodes.find((n) => n.id === d.target);
        return sourceNode.group === targetNode.group ? '0' : '5,5'; // Dashed for inter-network links
      });

    // Draw labels
    svg
      .selectAll('.label')
      .data(data.nodes)
      .enter()
      .append('text')
      .attr('class', 'label')
      .attr('text-anchor', 'middle')
      .attr('dy', -10)
      .text((d) => d.id);

    // Initial update
    updateGraph(map, svg, data);
  };

  const updateGraph = (
    map: mapboxgl.Map,
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    data: typeof graphData
  ) => {
    const project = (lngLat: [number, number]) => {
      const point = map.project(new mapboxgl.LngLat(lngLat[0], lngLat[1]));
      return [point.x, point.y];
    };

    // Update positions of links
    svg
      .selectAll('.link')
      .attr('x1', (d: any) => {
        const sourceNode = data.nodes.find((n) => n.id === d.source);
        return project(sourceNode.coordinates)[0];
      })
      .attr('y1', (d: any) => {
        const sourceNode = data.nodes.find((n) => n.id === d.source);
        return project(sourceNode.coordinates)[1];
      })
      .attr('x2', (d: any) => {
        const targetNode = data.nodes.find((n) => n.id === d.target);
        return project(targetNode.coordinates)[0];
      })
      .attr('y2', (d: any) => {
        const targetNode = data.nodes.find((n) => n.id === d.target);
        return project(targetNode.coordinates)[1];
      });

    // Update positions of nodes
    svg
      .selectAll('.node')
      .attr('cx', (d: any) => project(d.coordinates)[0])
      .attr('cy', (d: any) => project(d.coordinates)[1]);

    // Update positions of labels
    svg
      .selectAll('.label')
      .attr('x', (d: any) => project(d.coordinates)[0])
      .attr('y', (d: any) => project(d.coordinates)[1]);
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div
        ref={mapContainerRef}
        className="map-container"
        style={{ height: '100%', width: '100%' }}
      ></div>
      <CoreGlobe
        mapContainerRef={mapContainerRef}
        onLocationClick={onLocationClick}
        mapRef={mapRef} // Pass mapRef to CoreGlobe
      />
      <Popups />
    </div>
  );
};

export default Globe;
