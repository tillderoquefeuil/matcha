const neo4j = require('neo4j-driver').v1;

const passwordHash = require('password-hash');
const jwt = require('jwt-simple');

const config = require('../../config/config');
const time = require('../../controllers/utils/time');

const Location = require('./Location');
const File = require('./File');
const Match = require('./Match');

const fields = [
    'uid',
    'email', 'username', 'firstname', 'lastname',
    'valid', 'locked', 'connection_try',
    'providers', 'googleId', 'birthday',
    'gender', 'see_m', 'see_f', 'see_nb',
    'bio', 'profile_picture', 'language', 'online'
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

class User {

    constructor (node, params){
        let data = node.properties || node;

        params = params || {};
        transform(data);

        for (var i in fields){
            this[fields[i]] = data[fields[i]];
        }

        this._id = parseInt(data.uid);
		this.uid = this._id;

        if (passwordHash.isHashed(data.password)){
            this.password = data.password;
        } else if (data.password) {
            this.password = passwordHash.generate(data.password);
        }

        if (data.distance){
            this.distance = data.distance;
        }

        if (data.common_tags){
            this.common_tags = parseInt(data.common_tags);
        }

        if (data.p_rate >= 0){
            this.rate = parseInt(data.p_rate);
        }

        if (data.p_tags >= 0 && data.p_location >= 0){
            let pertinence = [
                (parseFloat(data.p_location) * 80),
                (parseFloat(data.p_tags) * 20)
            ];

            this.pertinence = pertinence.reduce(function(a, b){return a + b});
        }

        this.pictures = [];
        for (let i in params.pictures){
            let file = new File(params.pictures[i]);
            this.pictures.push(file);

            if (file.main){
                this.main_picture = file;
            }
        }

        if (params.tags){
            this.tags = params.tags;
        }

        if (params.location){
            this.location = new Location(params.location);
        }

        if (this.birthday){
            if (typeof this.birthday === 'string'){
                this.birthday = this.birthday.slice(0, 8);
            }
            this.age = time.getAgeFromDatetime(this.birthday);
        }

        if (params.match_relation && params.match_relation.match){
            this.match_relation = new Match(params.match_relation.match, params.match_relation.params);
        }
    }

    getPassword() {
        return this.password;
    }

    setPassword(pswd) {
        this.password = pswd;
    }

    authenticate(password) {
		return passwordHash.verify(password, this.getPassword());
	}
	
	getToken() {
		return jwt.encode(this, config.secret);
	}

	getName() {
		return this.firstname + ' ' + this.lastname;
	}

    isLocal() {
        if (this.providers.indexOf('local') !== -1){
            return true;
        }

        return false;
    }

}

module.exports = User;