Pop.Include = function (Filename)
{
	const Source = Pop.LoadFileAsString(Filename);
	return Pop.CompileAndRun(Source,Filename);
}
Pop.Include('PopEngineCommon/PopMath.js');
Pop.Include('PopEngineCommon/PopCamera.js');
Pop.Include('PopEngineCommon/PopShaderCache.js');
Pop.Include('PopEngineCommon/ParamsWindow.js');

Pop.Include('Expose.js');
Pop.Include('AssetManager.js');
Pop.Include('PopEngineCommon/PopFrameCounter.js');
Pop.Include('PopEngineCommon/PopAruco.js');


const RenderCounter = new Pop.FrameCounter('Render');
const PoseCounter = new Pop.FrameCounter('Poses');
const FrameImageCounter = new Pop.FrameCounter('FrameImage');
const PngKbCounter = new Pop.FrameCounter('Png kb');


const BlitQuadShader = RegisterShaderAssetFilename('Blit.frag.glsl','Quad.vert.glsl');


var DebugCounter = 0;

var Params = {};
Params.SkipEmptyPoses = true;
Params.PoseFrameRateMax = 60;
Params.MirrorFrameRateMax = 30;
Params.MirrorImageWidth = 256;
Params.MirrorImageHeight = 256;

var ParamsWindow = CreateParamsWindow(Params);
ParamsWindow.AddParam('SkipEmptyPoses');
ParamsWindow.AddParam('PoseFrameRateMax',1,90,Math.floor);
ParamsWindow.AddParam('MirrorFrameRateMax',1,90,Math.floor);
ParamsWindow.AddParam('MirrorImageWidth',2,1024,Math.floor);
ParamsWindow.AddParam('MirrorImageHeight',2,1024,Math.floor);


const ArucoNumber = Math.floor(Math.random() * 100);
const ArucoImage = Pop.Aruco.GetMarkerImage(4,4,ArucoNumber);


//	gr: these params are now different on web to desktop, fix this!
const ImageWidth = 1024;
const ImageHeight = 1024;
const HmdLeft = new Pop.Image();
const HmdRight = new Pop.Image();

let LastHmdFrameImage = null;

const InitPixels = new Uint8Array(ImageWidth * ImageHeight * 4);
HmdLeft.WritePixels(ImageWidth,ImageHeight,InitPixels,'RGBA');
HmdRight.WritePixels(ImageWidth,ImageHeight,InitPixels,'RGBA');

function RenderHmdEye(RenderTarget,Name,Camera)
{
	DebugCounter++;
	let Blue = (DebugCounter % 60) / 60;

	if (Name == "Left")
		RenderTarget.ClearColour(1,0,Blue);
	else
		RenderTarget.ClearColour(0,1,Blue);
}

function RenderHmdEyes(RenderTarget)
{
	//	todo: look at last poses for eye positions
	//	todo: return true/false to skip submitting frames
	function RenderLeft(RenderTarget)
	{
		RenderHmdEye(RenderTarget,"Left",null);
	}
	function RenderRight(RenderTarget)
	{
		RenderHmdEye(RenderTarget,"Right",null);
	}
	RenderTarget.RenderToRenderTarget(HmdLeft,RenderLeft);
	RenderTarget.RenderToRenderTarget(HmdRight,RenderRight);
}



function RenderTexture(RenderTarget,Texture,Rect)
{
	if (!Texture)
		return;

	const Quad = GetAsset('Quad',RenderTarget);
	const Shader = GetAsset(BlitQuadShader,RenderTarget);
	function SetUniforms(Shader)
	{
		Shader.SetUniform('Texture',Texture);
		Shader.SetUniform('VertexRect',Rect);
	}

	RenderTarget.DrawGeometry(Quad,Shader,SetUniforms);
}



//	we need some render context for openvr
const Window = new Pop.Opengl.Window("Render Context");
Window.OnRender = function (RenderTarget) 
{
	RenderTarget.ClearColour(0,1,1);
	RenderCounter.Add();

	//LastHmdFrameImage = Overlay.GetMirrorTexture();
	RenderTexture(RenderTarget,LastHmdFrameImage,[0,0,1,1]);


	//	draw marker on screen
	//	in the center
	{
		const RenderTargetRect = RenderTarget.GetScreenRect();
		let w = RenderTargetRect[2];
		let h = RenderTargetRect[3];
		if (w > h)
		{
			w = h / w;
			h = 1;
		}
		else
		{
			h = w / h;
			w = 1;
		}
		let Border = 0.2;
		w -= Border * w;
		h -= Border * h;
		const Rect = [(1 - w) / 2,(1 - h) / 2,w,h];
		RenderTexture(RenderTarget,ArucoImage,Rect);
	}


	//	update hmd textures
	if (Hmd)
	{
		RenderHmdEyes(RenderTarget);
		Hmd.SubmitFrame(HmdLeft,HmdRight);
	}
	if (Overlay)
	{
		RenderHmdEyes(RenderTarget);
		Overlay.SubmitFrame(HmdLeft);
	}
}
Window.OnMouseMove = function () { };

//	send callback
let SendPose = null;
let SendFramePng = null;

function MoveOverlay(Poses)
{
	if (!Overlay)
		return;

	function IsControllerPose(Pose)
	{
		return Pose.Class == "TrackedDeviceClass_Controller";
	}
	const Controllers = Poses.Devices.filter(IsControllerPose);
	if (!Controllers.length)
		return;
	
	let Transform = Controllers[0].LocalToWorld;

	//	temp as I havent written array stuff in chakra
	Transform = new Float32Array(Transform);
	Overlay.SetTransform(Transform);
}



function OnNewPose(Pose)
{
	//MoveOverlay(Pose);

	if (!SendPose)
		return;

	SendPose(Pose);
}


function SetupFakePose()
{
	async function Loop()
	{
		while(true)
		{
			await Pop.Yield(1000);
			const Pose = {};
			Pose.Message = "I am a pose";
			OnNewPose( Pose );
		}
	}
	Loop().then(Pop.Debug).catch(Pop.Debug);
}


async function HmdCaptureLoop()
{
	const SmallImage = new Pop.Image();
	while (Hmd || Overlay)
	{
		//	throttle the thread by making it wait, which makes it discard old poses
		//	gr: currently the socket isn't sending fast enough (soy code)
		await Pop.Yield(Math.floor(1000 / Params.MirrorFrameRateMax));

		let Openvr = Hmd || Overlay;
		//Pop.Debug("Waiting for poses");
		const RenderContext = Window;
		const ReadPixels = true;
		const FrameImage = await Openvr.WaitForMirrorImage(RenderContext, ReadPixels);
		FrameImageCounter.Add();

		LastHmdFrameImage = FrameImage;

		//if (!SendFramePng)			continue;

		//	get png
		//	todo: put pose into the exif
		SmallImage.Copy(FrameImage);
		SmallImage.Resize(Params.MirrorImageWidth,Params.MirrorImageHeight);
		const PngData = SmallImage.GetPngData(0.5);
		PngKbCounter.Add(PngData.length / 1024);
		if (SendFramePng )
			SendFramePng(PngData);
		//	encode to h264, send out nalu packets
	}
}


async function HmdPoseLoop()
{
	while ( Hmd || Overlay )
	{
		//	throttle the thread by making it wait, which makes it discard old poses
		//	gr: currently the socket isn't sending fast enough (soy code)
		await Pop.Yield( Math.floor(1000/Params.PoseFrameRateMax) );

		let Openvr = Hmd || Overlay;
		//Pop.Debug("Waiting for poses");
		const PoseStates = await Openvr.WaitForPoses();
		//Pop.Debug("Got new poses" + JSON.stringify(PoseStates));
		PoseCounter.Add();
		
		function DebugPose(Pose, Index)
		{
			if (!Pose.IsConnected)
				return;
			Pop.Debug(`Device ${Index} connected; valid=${Pose.IsValidPose}`);
		}
		//Poses.forEach(DebugPose);
	
		function ValidDevice(Device)
		{
			return Device.IsConnected;
		}
		PoseStates.Devices = PoseStates.Devices.filter(ValidDevice);

		//	skip empty poses
		if (Params.SkipEmptyPoses && PoseStates.Devices.length == 0)
			continue;

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
		PoseStates.Devices.forEach(CleanDevice);
	
		//Pop.Debug("Cleaned poses " + JSON.stringify(Poses));
		OnNewPose(PoseStates);
		//Pop.Debug("New JS Poses x" + Poses.length);
	}
}



//	create openvr overlay
//	gr: overlay isnt allowed poses??
const IsOverlay = true;
let Hmd;
let Overlay;

if (!IsOverlay)
{
	try
	{
		//	create openvr overlay
		Hmd = new Pop.Openvr.Hmd("Device Name");

		function OnError(Error)
		{
			Pop.Debug("HmdPoseLoop finished:" + Error);
		}

		HmdPoseLoop().then(OnError).catch(OnError);
		HmdCaptureLoop().then(OnError).catch(OnError);
	}
	catch (e)
	{
		Pop.Debug("Failed to setup HMD " + e);
		SetupFakePose();
	}
}
else
{
	Overlay = new Pop.Openvr.Overlay("Expose");

	function OnError(Error)
	{
		Pop.Debug("HmdPoseLoop finished:" + Error);
	}

	HmdPoseLoop().then(OnError).catch(OnError);
	HmdCaptureLoop().then(OnError).catch(OnError);
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

					SendFramePng = function (Object)
					{
						const Peers = Socket.GetPeers();
						const Message = (Object);
						function SendToPeer(Peer)
						{
							try
							{
								//Pop.Debug("Sending to " + Peer,Message);
								Socket.Send(Peer,Message);
							}
							catch (e)
							{
								Pop.Debug("Error sending png to " + Peer + "; " + e);
							}
						}
						Peers.forEach(SendToPeer);
					}
				}

				const Message = await Socket.WaitForMessage();
				OnMessage(Message,Socket);
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
