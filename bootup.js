Pop.Include = function (Filename)
{
	const Source = Pop.LoadFileAsString(Filename);
	return Pop.CompileAndRun(Source,Filename);
}
Pop.Include('Expose.js');


//	we need some render context for openvr
const Window = new Pop.Opengl.Window("Render Context");
Window.OnRender = function (RenderTarget) {
	RenderTarget.ClearColour(0, 1, 1);
}


//	queue of outputs to send
const OutputPoses = [];

function OnOutputPose(Pose)
{
	OutputPoses.push(Pose);
	//	wake up output thread
}



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
	//Poses.forEach(EnumPose);
	//Pop.Debug("New JS Poses x" + Poses.length);

	//	turn this into 
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
			}
		}
		catch (e)
		{
			Pop.Debug("Exception in server loop: " + e);
			await Pop.Yield(2000);
		}
	}
}


RunBroadcast(OnBroadcastMessage).then(Pop.Debug).catch(Pop.Debug);
RunServer(OnRecievedMessage).then(Pop.Debug).catch(Pop.Debug);
