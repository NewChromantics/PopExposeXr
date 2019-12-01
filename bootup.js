Pop.Include = function (Filename)
{
	const Source = Pop.LoadFileAsString(Filename);
	return Pop.CompileAndRun(Source,Filename);
}
Pop.Include('Expose.js');


//	we need some render context for openvr
const Window = new Pop.Opengl.Window("Render Context");
Window.OnRender = function (RenderTarget) 
{
	RenderTarget.ClearColour(0, 1, 1);
}
Window.OnMouseMove = function () { };


let SendPose = null;

let PendingPoses = [];

function OnNewPose(Pose)
{
	if (!SendPose)
		return;

	PendingPoses.push(Pose);
	//SendPose(Pose);
}

//	throttled loop for now
async function SendLoop()
{
	while (true)
	{
		Pop.Debug("Send pose");
		if (!PendingPoses.length)
		{
			await Pop.Yield(700);
			continue;
		}

		const Pose = PendingPoses[PendingPoses.length - 1];
		PendingPoses = [];
		SendPose(Pose);
		
		//await Pop.Yield(1);
	}
}
SendLoop().then(Pop.Debug).catch(Pop.Debug);



//	create openvr overlay
const IsOverlay = false;
const Hmd = new Pop.Openvr.Hmd("Device Name",Window);

Hmd.OnPoses = function (Poses)
{
	function EnumPose(Pose, Index)
	{
		if (!Pose.IsConnected)
			return;
		Pop.Debug(`Device ${Index} connected; valid=${Pose.IsValidPose}`);
	}

	function ValidDevice(Device)
	{
		return Device.IsConnected;
	}
	Poses = Poses.filter(ValidDevice);

	function CleanDevice(Device)
	{
		//	any float32array's we need as arrays for delivery otherwise we
		//	generate objects with keys 0,1,2,3 etc
		const Keys = Object.keys(Device);
		function ConvertTypedArrayToArray(Value)
		{
			if (Value instanceof Float32Array)
			{
				const FloatArray = Array.from(Value);
				return FloatArray;
			}
			return Value;
		}
		function ConvertKey(Key)
		{
			Device[Key] = ConvertTypedArrayToArray(Device[Key]);
		}
		Keys.forEach(ConvertKey);
	}
	Poses.forEach(CleanDevice);
	//Pop.Debug("Cleaned poses " + JSON.stringify(Poses));
	OnNewPose(Poses);
	//Poses.forEach(EnumPose);
	//Pop.Debug("New JS Poses x" + Poses.length);
}

Hmd.OnRender = function(RenderTarget,Camera)
{
	if ( Camera.Name == "Left" )
		RenderTarget.ClearColour( 1,0,0 );
	else if ( Camera.Name == "Right" )
		RenderTarget.ClearColour( 0,1,0 );
	else
		RenderTarget.ClearColour( 0,0,1 );
}



function OnBroadcastMessage(Message,Socket)
{
	//	send back our address
	Pop.Debug("Got broadcast message",JSON.stringify(Message));
	Socket.Send(Message.Peer,"Hello");
}


function OnRecievedMessage(Message,Socket)
{
	//	send to expose api for decoding
	Pop.Debug("Got message",JSON.stringify(Message));
}

//	create discovery udp
async function RunBroadcast(OnMessage)
{
	while (true)
	{
		try
		{
			const Socket = new Pop.Socket.UdpBroadcastServer(Expose.BroadcastPorts[0]);
			Pop.Debug("Broadcast listening on ",JSON.stringify(Socket.GetAddress()));

			while (true)
			{
				Pop.Debug("Waiting for message");
				const Message = await Socket.WaitForMessage();
				OnMessage(Message,Socket);
			}
		}
		catch (e)
		{
			Pop.Debug("Exception in broadcast loop: " + e);
			await Pop.Yield(2000);
		}
	}
}



//	keep trying to run servers
async function RunServer(OnMessage)
{
	let PortIndex = 0;
	function GetPortIndex()
	{
		const PortCount = Expose.ListenPorts.length;
		PortIndex = (PortIndex + 1) % PortCount;
		return Expose.ListenPorts[PortIndex];
	}

	while (true)
	{
		try
		{
			const Port = GetPortIndex();
			const Socket = new Pop.Websocket.Server(Port);


			Pop.Debug("Websocket listening on ",JSON.stringify(Socket.GetAddress()));

			while (true)
			{
				const Message = await Socket.WaitForMessage();
				OnMessage(Message,Socket);

				if (!SendPose)
				{
					//	gr: this was causing an error, because I THINK we send a packet before handshake is finished?
					//		temp fix, added to WaitForMessage
					//	gr: maybe need peer's to finish connecting?
					SendPose = function (Object)
					{
						const Peers = Socket.GetPeers();
						const Message = JSON.stringify(Object);
						function SendToPeer(Peer)
						{
							try
							{
								//Pop.Debug("Sending to " + Peer,Message);
								Socket.Send(Peer,Message);
							}
							catch (e)
							{
								Pop.Debug("Error sending pose to " + Peer + "; " + e);
							}
						}
						Peers.forEach(SendToPeer);
					}
				}
			}
		}
		catch (e)
		{
			SendPose = null;
			Pop.Debug("Exception in server loop: " + e);
			await Pop.Yield(2000);
		}
	}
}


//RunBroadcast(OnBroadcastMessage).then(Pop.Debug).catch(Pop.Debug);
RunServer(OnRecievedMessage).then(Pop.Debug).catch(Pop.Debug);
