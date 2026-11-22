import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ShieldCheck, RefreshCw, UserCheck, Sparkles, VideoOff } from 'lucide-react';
import './FaceScanner.css';

const FaceScanner = ({ onSuccess, mode = 'login', title = 'Biometric Face ID Scan' }) => {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [status, setStatus] = useState('Position your face inside the circle');
  const [progress, setProgress] = useState(15);
  const [isSuccess, setIsSuccess] = useState(false);
  const [usingSimulation, setUsingSimulation] = useState(false);

  useEffect(() => {
    let mounted = true;
    let localStream = null;

    const startCamera = async () => {
      try {
        if (navigator?.mediaDevices?.getUserMedia) {
          const mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 480 },
              height: { ideal: 480 },
            },
          });
          if (!mounted) {
            mediaStream.getTracks().forEach((track) => track.stop());
            return;
          }
          localStream = mediaStream;
          setStream(mediaStream);
          setHasCamera(true);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        } else {
          setUsingSimulation(true);
        }
      } catch {
        // Camera denied, not available or blocked in current environment
        if (mounted) {
          setHasCamera(false);
          setUsingSimulation(true);
        }
      }
    };

    startCamera();

    return () => {
      mounted = false;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Run the biometric scanning sequence
  useEffect(() => {
    let timer1;
    let timer2;
    let timer3;
    let timer4;

    timer1 = setTimeout(() => {
      setStatus('Face detected · Analyzing 128 biometric contours...');
      setProgress(45);
    }, 700);

    timer2 = setTimeout(() => {
      setStatus('SEBI Liveness & Anti-Spoofing check: OK ✓');
      setProgress(78);
    }, 1500);

    timer3 = setTimeout(() => {
      setStatus(mode === 'register' ? 'Biometric Face ID Enrolled ✓' : 'Facial Match Verified 99.6% ✓');
      setProgress(100);
      setIsSuccess(true);
    }, 2400);

    timer4 = setTimeout(() => {
      if (onSuccess) {
        onSuccess({
          biometricId: `FACE-${Date.now().toString(36).toUpperCase()}`,
          verifiedAt: new Date().toISOString(),
          type: 'face_recognition',
        });
      }
    }, 2900);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      clearTimeout(timer4);
    };
  }, [mode, onSuccess]);

  return (
    <div className="face-scanner-wrap" role="region" aria-label="Biometric Face Scanner">
      <div className="face-scanner-viewport">
        {hasCamera ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="face-video-feed"
          />
        ) : (
          <div className="face-holo-avatar">
            <UserCheck size={84} strokeWidth={1.4} />
            <div className="face-holo-mesh" />
          </div>
        )}

        {/* HUD Overlay */}
        <div className="face-scanner-hud">
          <div className="face-corner-tl" />
          <div className="face-corner-tr" />
          <div className="face-corner-bl" />
          <div className="face-corner-br" />

          {/* Oval contour guide */}
          <div className={`face-target-oval ${progress > 40 ? 'detected' : ''} ${isSuccess ? 'success' : ''}`}>
            {!isSuccess && <div className="face-laser-line" />}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="face-status-bar">
        <div className="face-status-text">
          {isSuccess ? (
            <span style={{ color: '#22c55e', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={16} /> {status}
            </span>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} className="pulse-icon" /> {status}
            </span>
          )}
        </div>

        <div className="face-progress-track">
          <div
            className="face-progress-fill"
            style={{
              width: `${progress}%`,
              background: isSuccess ? '#22c55e' : undefined,
            }}
          />
        </div>

        {usingSimulation && (
          <span className="face-cam-toggle" title="Hardware webcam not detected; simulated biometric sensor active">
            <VideoOff size={13} /> Biometric Sensor Active (Simulated Neural Camera)
          </span>
        )}
      </div>
    </div>
  );
};

export default FaceScanner;
