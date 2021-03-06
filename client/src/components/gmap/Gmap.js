import React from 'react';

import { Component } from '../Component';
import { Map } from './Map';

import './gmap.css';

const coords = {
    lat : 48.85340440403773,
    lng : 2.3487839388235443
};

export class Gmap extends Component {

    constructor(props){
        super(props);

        this.state = {
            height      : props.height || 500,
            zoom        : props.zoom || 10,
            map         : null,
            autocomplete: null,
            markers     : {}
        }
    }

    componentDidMount() {
        this._isMounted = true;

        if (this.onLoadedData){
            this.onLoaded(this.onLoadedData);
            this.onLoadedData = null;
        }
    }


    componentDidUpdate() {

        if (this.on_loaded && this.props.onLoaded){
            this.on_loaded = false;
            this.props.onLoaded();
        }

    }

    onLoaded(data) {
        if (!this._isMounted){
            this.onLoadedData = data;
            return;
        }

        this.on_loaded = true;
        this.setState({
            map         : data.map,
            autocomplete: data.autocomplete
        });
    }

    getData() {
        return {
            map             : this.state.map,
            autocomplete    : this.state.autocomplete
        }
    }

    initOptions() {
        return ({
            map     : {
                zoom                : this.state.zoom,
                center              : coords,
                panControl          : false,
                mapTypeControl      : false,
                streetViewControl   : false
            },
            places  : {
                types               : ['geocode']
            }
        });
    }

    removeMarkers() {
        let markers = this.state.markers;

        for (let i in markers){
            this.removeMarker(markers[i]);
        }
    }

    removeMarker(marker) {
        marker.setMap(null);
    }

    addMarker(params) {
        let map = this.state.map;

        if (!params.lat || !params.lng){
            return null;
        }

        let marker = new window.google.maps.Marker({
            map         : map,
            position    : {lat: params.lat, lng: params.lng},
            draggable   : params.draggable || false
        });

        if (params.draggable && params.onDragEnd){
            marker.addListener('dragend', e => {
                params.onDragEnd(e);
            });
        }

        marker._id = 'marker_' + (new Date()).getTime();

        let markers = this.state.markers;
        markers[marker._id] = marker;

        this.setState({markers : markers});
        
        if (params.focus){
            this.focusOnLocation(params);
        }

        return marker;
    }


    focusOnLocation(location){
        if (!location.lat || !location.lng){
            return;
        }

        let map = this.state.map;
        let coords = {
            lat : location.lat,
            lng : location.lng
        }

        map.panTo(coords);
        map.setZoom(15);
    }

    forceAutocomplete(address){
        this.gmap.forceAutocomplete(address);
    }

    render() {
        return (

            <div>
                <div className="center">
                    <Map 
                        ref={ el => this.gmap = el }
                        map="gmap-maps"
                        autocomplete="gmap-autocomplete"
                        height={ this.state.height }
                        options={ this.initOptions() }
                        onLoad={ data => this.onLoaded(data) }
                    />
                </div>
            </div>

        );
    }

}