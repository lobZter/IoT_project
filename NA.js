// import required libraries
var express = require('express')
  , colors = require('colors')
  , TimerJob = require('timer-jobs')
  , net = require('net')
  , http = require('http')
  , openmtc = require('openmtc')
  , XIA = openmtc.interfaces.xIa
  , HttpAdapter = openmtc.transport.http.client
  , gscl = openmtc.config_gscl.scl
  , nscl = openmtc.config_nscl.scl;

// maps primitives to http
var HttpClient = openmtc.transport.http.client;

//our app's configuration
var config = {
  host: '140.113.65.29',
  port: '55557',
  appId: 'Dorm7_110_NA',
  containerID:'trigger', 		//the name of our application's data container
  maxNrOfInstances:1,			//max number of contentInstances in our container
};

var targetApplicationID = 'Dorm7_110_DA';
var targetSclID = 'openmtc-gscl';
var contactURI = 'http://' + config.host + ':' + config.port;
var notificationPath = '/notify';

var currentData = [];

//create client for dIa interface
//generic communication module
//sclUri for re-targeting
var httpClient = new HttpClient({ sclUri: nscl.dia.hostUri });
var dIaClient = new XIA(nscl.uri, httpClient, 'dIa');

var app = express();
app.configure(function () {
  app.use(express.static(__dirname + '/public'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
});
var dIaServer = http.createServer(app);
dIaServer.listen(config.port);

app.get("/initial_data", function(req, res) {
	console.log("Got request for initial data.");
	res.send(currentData);
});




/* event channel */
/*var eventChannel = require('socket.io').listen(dIaServer);



eventChannel.sockets.on('connection', function (socket) {
  'use strict';
  console.log('socket browser connected');
  socket.on('echo', function (echo_data) {
    console.log('Echo data: ' + echo_data);
    eventChannel.sockets.emit('echo-back', 'this is from server-' + echo_data);
  });
});*/



//some helper methods to decode contentInstance data
function parseB64Json(s) {
  return JSON.parse(new Buffer(s, 'base64').toString('utf8'));
}
function getRepresentation(o) {
  if (o.representation.contentType !== 'application/json') {
    throw new Error("Unknown content type");
  }
  return JSON.parse(new Buffer(o.representation.$t, 'base64').toString('utf8'));
}
function getNotificationData(req) {
	return getRepresentation(req.body.notify);
}




function handleContentInstances(contentInstances) {
        
    console.log("Handling ContentInstances.".bgYellow);
    //console.log(contentInstances);
    var contentInstanceCollection = contentInstances.contentInstanceCollection.contentInstance;
    console.log("Number of Instances: " + contentInstanceCollection.length);

    //convert the raw data to the structure we require
    for (var i = 0; i < contentInstanceCollection.length; ++i) {

        //we now have the BASE64 representation of our data. We still need to decode it:
        var dataPoint = parseB64Json(contentInstanceCollection[i].content.$t);
        //console.log(dataPoint);

        //dataPoint is an object. We want a tuple of ( timestamp, value )
        var timestamp = new Date(parseInt(dataPoint.timestamp));
        //var timestamp = parseInt(dataPoint.timestamp);

        console.log(dataPoint.value + ", " + timestamp);

        currentData.push( [ timestamp, parseFloat(dataPoint.value) ] );
    }

    //eventChannel.sockets.emit('data', currentData);
}

function subscrideToContainer(containerId) {
        
    console.log('Subscribing to containers...'.bgYellow);
    //we are not interested in the container itself, only in its contentInstances

    //The internal URI path we will receive notifications about new contentInstances on
    var notifyPath = notificationPath + "/contentInstances";

    //The full external URI, that we will communicate as contactURI to the SCL 
    var notifyUri = contactURI + notifyPath;

    //Tell express JS to accept requests for the defined notification path
    app.post(notifyPath, function(req, res) {
        console.log("Got contentInstances notification".bgYellow);
        //console.log(req.body);
        var notificationData = getNotificationData(req);
        //console.log(notificationData);
        handleContentInstances(notificationData.contentInstances);
        res.send(200);
    });

    dIaClient.requestIndication(
        'CREATE', null, 
        gscl.dia.hostUri + containerId + '/contentInstances/subscriptions', 
        { subscription: { contact: notifyUri } }
    ).on('STATUS_CREATED', function (data) {
        console.log('Subscribed to contentInstances of '.bgYellow + containerId.bgYellow);
    }).on("ERROR", function(err){
        console.log("Failed to  create subscription for contentInstances: ".bgYellow + err.bgYellow);
    });
}

function handleContainersData(containers) {

    console.log("Handling containers data.".bgYellow);

    var containerReferences = containers.containerCollection.namedReference;

    //actually the DA should only have created a single container,
    //we anyway loop through the whole list, just to be safe
    for (var i = 0; i < containerReferences.length; ++i) {
        var containerReference = containerReferences[i];
        subscrideToContainer(containerReference.$t);
    }
}

function subscrideToDeviceApplication(deviceApplicationId) {

    console.log("Subscribe to DA: ".bgYellow + deviceApplicationId.bgYellow);

    //Now we will retrieve information about all its containers
    //The internal URI path we will receive notifications about new containers on
    var notifyPath = notificationPath + "/containers";

    //The full external URI, that we will communicate as contactURI to the SCL 
    var notifyUri = contactURI + notifyPath;

    //Tell express JS to accept requests for the defined notification path
    app.post(notifyPath, function(req, res) {
        console.log("Got containers notification.".bgYellow);
        var notificationData = getNotificationData(req);
        //console.log(notificationData);

        handleContainersData(notificationData.containers);

        res.send(200);
    });

    dIaClient.requestIndication(
        'CREATE', null, 
        gscl.dia.hostUri + deviceApplicationId + '/containers/subscriptions', 
        { subscription: { contact: notifyUri } }
    ).on('STATUS_CREATED', function (data) {
        console.log('Subscribed to containers of '.bgYellow + deviceApplicationId.bgYellow);
    }).on("ERROR", function(err){
        console.log("Failed to create subscription for containers: ".bgYellow + err.bgYellow);
    });
}

function handleApplicationsData(applications) {
        
    console.log("Handling applications data.".bgYellow);

    var applicationReferences = applications.applicationCollection.namedReference;

    //we get information about all registered apps. 
    //Here we look for the one we are actually interested in
    for (var i = 0; i < applicationReferences.length; ++i) {
        var applicationReference = applicationReferences[i];
        console.log("Found an application: " + applicationReference);
        if (applicationReference.id == targetApplicationID)
            // dirty hack because of dead locks with announcements and retargeting
            setTimeout(function () {
                subscrideToDeviceApplication(applicationReference.$t);
            }, 100);
    }
}

function subscrideToApplications() {

	console.log('Subscribing to applications...'.bgYellow);
  //first make sure that we are able to receive notifications
    
  //The internal URI path we will receive notifications about new applications on
	var notifyPath = notificationPath + "/applications";

  //The full external URI, that we will communicate as contactURI to the SCL 
	var notifyUri = contactURI + notifyPath;

  //Tell express JS to accept requests for the defined notification path
	app.post(notifyPath, function(req, res) {
		console.log("Got applications notification.".bgYellow);
		var notificationData = getNotificationData(req);
		//console.log(notificationData);

		handleApplicationsData(notificationData.applications);

		res.send(200);
	});

    
	dIaClient.requestIndication(
        'CREATE', null,
		gscl.dia.uri + '/applications/subscriptions',
		{ subscription: { contact: notifyUri } }
	).on('STATUS_CREATED', function (data) {
        console.log('Subscribed to applications.'.bgYellow);
	}).on("ERROR", function(err){
	    console.log("Failed to create subscription for applications: ".bgYellow + err.bgYellow);
    });
}

function handleSclsData(scls) {
        
    console.log("Handling scls data.".bgYellow);

    var sclReferences = scls.sclCollection.namedReference;

    //Now we receive information about all scls registered at the nscl.
    //We will search for the target scl hosting the target application that we want to subscribe to.
    for (var i = 0; i < sclReferences.length; ++i) {
        var sclReference = sclReferences[i];
        console.log("Found an scl: " + sclReference);
        //If targetSCL found then subscribe to applications at GSCL
        if (sclReference.id == targetSclID) {
            console.log("Found my Target SCL : ".bgYellow + sclReference.id.bgYellow);
            subscrideToApplications();
        } 
        else
            console.log("Target SCL not found".bgYellow);
    }
}

function subscribeToScls() {
        
    console.log('Subscribing to scls'.bgYellow);
    //first make sure that we are able to receive notifications

    //The internal URI path we will receive notifications about new scls on
	var notifyPath = notificationPath + "/scls";

    //The full external URI, that we will communicate as contactURI to the SCL 
	var notifyUri = contactURI + notifyPath;

    //Tell express JS to accept requests for the defined notification path
	app.post(notifyPath, function(req, res) {
		console.log("Got scls notification.".bgYellow);
		var notificationData = getNotificationData(req);
		//console.log(notificationData);

		handleSclsData(notificationData.scls);

		res.send(200);
	});

	dIaClient.requestIndication(
        'CREATE', null,
		nscl.dia.uri + '/scls/subscriptions',
		{ subscription: { contact: notifyUri } }
	).on('STATUS_CREATED', function (data) {
        console.log('Subscribed to scls.'.bgYellow);
	}).on("ERROR", function(err){
        console.log("Fail to create subscription for scls: ".bgYellow + err.bgYellow);
    });
}

function createContainer() {
	
	console.log("Creating Container".bgYellow);
	
	var containerData = { 
		container:
		{
			id: config.containerID,
			maxNrOfInstances: config.maxNrOfInstances
		}
	};

	dIaClient.requestIndication(
		'CREATE', null,
		nscl.dia.uri + '/applications/' + config.appId + '/containers',
		containerData
	).on('STATUS_CREATED', function (data) {
		console.log('Container Created'.bgYellow);

        app.get('/trigger', function(req, res) {
            
            console.log("Received data: ".bgYellow, req.url);
            
            var dataToPush = {
                value: req.query.ONorOFF,
            }
            
            pushData(dataToPush);
            
            res.send(200);
        });
		
	}).on('ERROR', function(error) {
		console.log("Failed to create container".bgYellow);
	});
}

function main() {
	console.log("Registering network application".bgYellow);

	var appData = {
		application: { appId: config.appId }
	};

	dIaClient.requestIndication(
        'CREATE', null, 
		nscl.dia.uri + '/applications',
        appData
	).on('STATUS_CREATED', function (data) {
		console.log('Network application registered.'.bgYellow)

		createContainer();
		subscribeToScls();

	}).on('ERROR', function(err) {
		//409 is the HTTP error code for "conflict". This error occurs when an application
		//with the same ID as ours is already registered. 
		//For our training scenario, we'll just assume that we are already registered. 
		//In 'reality' we would of course have to handle this more sophisticated.
		if (err == 409) {
            console.log("Network application already registered.".bgYellow);
            createContainer();
            subscribeToScls();
		} 
        else
            console.log("Failed to register network application: ".bgYellow + err.bgYellow);
	});
}

function pushData(data) {

	console.log('Pushing data: '.bgYellow, data);

	var contentInstance = {
		contentInstance: {
			content: {
				$t: new Buffer(JSON.stringify(data)).toString('base64'),  //Base64 representation of our data
				contentType: 'application/json'
			}
		}
	};

	dIaClient.requestIndication(
		'CREATE', null,                                             //What do we want to do? (Create something)
		nscl.dia.uri + '/applications/' + config.appId +            //Where, at what URI? (As a child of the contentInstances)
		'/containers/' + config.containerID + '/contentInstances',
		contentInstance
	).on('STATUS_CREATED', function (data) {  //What to do when it worked?
		console.log('***Data pushed***'.bgYellow);       //Rejoice!
	}).on('ERROR', function(error) {             //What to do when it did not work?
		console.log("***Failed to push data***".bgYellow);  //Just weep in shame
	});
}





main();
