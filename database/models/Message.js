const neo4j = require('neo4j-driver').v1;
const Files = require('../../controllers/utils/files.js');

const fields = [
    'value', 'date'
];

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

class Message {

    constructor (node, params){
        let data = node.properties || node;

        params = params || {};

        transform(data);

        for (var i in fields){
            this[fields[i]] = data[fields[i]];
        }

        this._id = parseInt(data.uid);
		this.uid = this._id;

        if (params.conv){
            this.conv_id = parseInt(params.conv.properties.uid);
        }

        if (params.sender){
            this.sender_id = parseInt(params.sender.properties.uid);
        }

        if (params.own){
            let own = params.own.properties;
            this.last = own.last;
        }

        if (params.files){
            let files = {};

            for (let i in params.files){
                let file = params.files[i].properties;
                transform(file);
                file.url = Files.getFilePath() + file.filename;
                files[file.id] = file;
            }

            this.files = Object.values(files);
        }

    }

}

module.exports = Message;