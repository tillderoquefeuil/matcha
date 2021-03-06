const neo4j = require('neo4j-driver').v1;

const File = require('./File');


const fields = [
    'date', 'type',
    'read',
    'partner_id', 'partner_label'
];

const events = {
    1   : { label : 'liked', link : true},
    2   : { label : 'visited', link : true},
    3   : { label : 'match', link : true},
    4   : { label : 'unliked', link : false}
};

function transform(object) {
    for (let property in object) {
        if (object.hasOwnProperty(property)) {
            const propertyValue = object[property];
            if (neo4j.isInt(propertyValue)) {
                object[property] = propertyValue.toString();
            } else if (typeof propertyValue === 'object') {
                transform(propertyValue);
            }
        }
    }
}


class Event {

    constructor (node, params){
        let data = node.properties || node;

        transform(data);

        for (var i in fields){
            this[fields[i]] = data[fields[i]];
        }
        this._id = parseInt(data.uid);
		this.uid = this._id;

        if (events[this.type]){
            this.label = events[this.type].label;
            this.link = events[this.type].link;
        }

        if (params.partner_picture){
            this.partner_picture = new File(params.partner_picture);
        }


        if (params.user){
            this.user_id = parseInt(params.user.properties.uid)
        }
    }

}

module.exports = Event;